/**
 * Cafe Finder V2 — Intelligence Engine
 * --------------------------------------------------
 * Pure, dependency-free heuristic functions that power the AI Ranking Engine,
 * Study/Meeting modes, review summarization, peak-hour & crowd prediction,
 * budget intelligence, and menu-item suggestions described in the V2 spec.
 *
 * NOTHING in this file touches the DOM or the existing app.js state. It only
 * reads plain Google Places result/details objects and returns plain data,
 * so it is 100% additive to the existing app.
 *
 * Every function here is intentionally heuristic (rating, price, review
 * keyword matching, seeded pseudo-randomness for signals we don't have real
 * data for). Each is written so the *inputs/outputs* stay stable if a real
 * LLM or a richer data source replaces the internals later — see the
 * "REPLACEABLE" markers below.
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------
  // Deterministic "seeded randomness" so the same cafe always gets the same
  // simulated signals across renders/sessions (until real data replaces it).
  // ---------------------------------------------------------------------
  function makeSeededRng(seedStr) {
    let h = 2166136261 >>> 0;
    const str = String(seedStr || 'cafe');
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    }
    return function next() {
      h = Math.imul(h ^ (h >>> 15), 2246822519);
      h = Math.imul(h ^ (h >>> 13), 3266489917);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    };
  }

  function seedFor(place) {
    return (place && (place.place_id || place.name)) || 'cafe';
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  // ---------------------------------------------------------------------
  // Keyword lexicons used to scan whatever review text we *do* have access
  // to (Place Details `reviews[].text`). When no review text is available
  // (plain nearby/text search results don't include it) we fall back to
  // rating + price + seeded signals only.
  // ---------------------------------------------------------------------
  const LEXICON = {
    wifi: ['wifi', 'wi-fi', 'internet', 'charging', 'plug point', 'power outlet'],
    quiet: ['quiet', 'peaceful', 'calm', 'cozy', 'silent', 'work', 'laptop', 'study', 'studying'],
    noisy: ['loud', 'noisy', 'crowded', 'packed', 'chaotic'],
    romantic: ['romantic', 'date', 'ambience', 'lighting', 'decor', 'aesthetic', 'view', 'intimate', 'cosy'],
    family: ['family', 'kids', 'kid-friendly', 'children', 'highchair', 'spacious', 'parking'],
    group: ['group', 'large table', 'birthday', 'party', 'celebration', 'friends', 'hangout'],
    professional: ['meeting', 'professional', 'business', 'discussion', 'work call', 'conference'],
    service: ['service', 'staff', 'waiter', 'server'],
    slowService: ['slow service', 'slow staff', 'wait long', 'took forever', 'understaffed'],
    parkingIssue: ['no parking', 'parking issue', 'parking problem', 'limited parking'],
    priceComplaint: ['expensive', 'overpriced', 'pricey'],
    tastePositive: ['delicious', 'tasty', 'great coffee', 'good coffee', 'amazing food', 'flavour', 'flavor'],
    ambiencePositive: ['lovely ambience', 'great ambience', 'beautiful', 'aesthetic', 'cozy', 'nice vibe', 'great vibe']
  };

  function countMatches(text, words) {
    if (!text) return 0;
    const t = text.toLowerCase();
    let count = 0;
    for (const w of words) {
      if (t.indexOf(w) !== -1) count++;
    }
    return count;
  }

  function collectReviewText(place) {
    if (!place || !Array.isArray(place.reviews)) return '';
    return place.reviews.map(r => r.text || '').join(' \n ');
  }

  // ---------------------------------------------------------------------
  // 1. AI RANKING ENGINE
  // REPLACEABLE: swap the body of `scoreCafe` for an LLM call that takes the
  // same `place` object (+ review text) and returns the same score shape.
  // ---------------------------------------------------------------------
  function scoreCafe(place) {
    const rng = makeSeededRng(seedFor(place));
    const rating = typeof place.rating === 'number' ? place.rating : 3.8 + rng() * 0.6;
    const reviewCount = place.user_ratings_total || Math.round(50 + rng() * 900);
    const price = typeof place.price_level === 'number' ? place.price_level : Math.round(1 + rng() * 2);
    const types = (place.types || []).join(' ').toLowerCase();
    const reviewText = collectReviewText(place);
    const hasRealReviewText = reviewText.length > 0;

    // Base confidence from rating (0-60) and review volume (0-15, log scale)
    const ratingBase = clamp((rating / 5) * 60, 0, 60);
    const volumeBoost = clamp(Math.log10(reviewCount + 1) * 5, 0, 15);

    // Keyword signals — real if we have review text, otherwise a plausible
    // seeded approximation so cards never look empty/identical.
    const sig = name => {
      if (hasRealReviewText) return countMatches(reviewText, LEXICON[name]);
      // Simulated signal: biased by rating/price so it still feels coherent
      return rng() * 2.2;
    };

    const wifiSig = sig('wifi');
    const quietSig = sig('quiet');
    const noisySig = sig('noisy');
    const romanticSig = sig('romantic');
    const familySig = sig('family');
    const groupSig = sig('group');
    const proSig = sig('professional');

    const kw = (positive, negative) => clamp((positive - negative) * 4, -10, 25);

    const work = clamp(
      ratingBase * 0.55 + volumeBoost * 0.6 + kw(wifiSig + quietSig, noisySig) + (price <= 2 ? 5 : 0),
      5, 100
    );
    const student = clamp(
      ratingBase * 0.45 + volumeBoost * 0.5 + kw(wifiSig + quietSig, noisySig) + (price <= 2 ? 12 : price >= 4 ? -10 : 2),
      5, 100
    );
    const date = clamp(
      ratingBase * 0.75 + volumeBoost * 0.3 + kw(romanticSig, noisySig * 0.5) + (price >= 3 ? 6 : -2),
      5, 100
    );
    const family = clamp(
      ratingBase * 0.6 + volumeBoost * 0.4 + kw(familySig, 0) + (types.includes('restaurant') ? 5 : 0),
      5, 100
    );
    const group = clamp(
      ratingBase * 0.55 + volumeBoost * 0.45 + kw(groupSig, 0) + (price <= 3 ? 4 : 0),
      5, 100
    );
    const meeting = clamp(
      ratingBase * 0.6 + volumeBoost * 0.55 + kw(proSig + quietSig, noisySig) + (reviewCount > 300 ? 5 : 0),
      5, 100
    );

    return {
      work: Math.round(work),
      student: Math.round(student),
      date: Math.round(date),
      family: Math.round(family),
      group: Math.round(group),
      meeting: Math.round(meeting),
      _confidence: hasRealReviewText ? 'review-based' : 'heuristic-estimate'
    };
  }

  const CATEGORY_META = {
    work: { label: 'Best For Work', emoji: '💻' },
    student: { label: 'Best For Students', emoji: '📚' },
    date: { label: 'Best For Dates', emoji: '❤️' },
    family: { label: 'Best For Family', emoji: '👨‍👩‍👧‍👦' },
    group: { label: 'Best For Groups', emoji: '👥' },
    meeting: { label: 'Best For Meetings', emoji: '🤝' }
  };

  function overallScore(scores) {
    const vals = Object.keys(CATEGORY_META).map(k => scores[k] || 0);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const peak = Math.max.apply(null, vals);
    return Math.round(avg * 0.6 + peak * 0.4);
  }

  function bestForTags(scores, limit) {
    limit = limit || 2;
    return Object.keys(CATEGORY_META)
      .map(key => ({ key, ...CATEGORY_META[key], score: scores[key] || 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // ---------------------------------------------------------------------
  // 2. STUDY MODE / MEETING MODE reasoning strings
  // ---------------------------------------------------------------------
  function studyReason(scores) {
    const bits = [];
    if (scores.student >= 80) bits.push('Strong WiFi & quiet environment');
    else if (scores.student >= 60) bits.push('Decent WiFi, moderate noise');
    else bits.push('Limited workspace comfort');
    bits.push(scores.student >= 70 ? 'good for long study sessions' : 'better for short visits');
    return bits.join(', ') + '.';
  }

  function meetingReason(scores) {
    const bits = [];
    bits.push(scores.meeting >= 80 ? 'Professional, low-noise atmosphere' : scores.meeting >= 60 ? 'Reasonably quiet, decent seating' : 'Can get busy/noisy');
    bits.push(scores.meeting >= 75 ? 'ideal for discussions' : 'okay for casual chats');
    return bits.join(', ') + '.';
  }

  // ---------------------------------------------------------------------
  // 3. BUDGET INTELLIGENCE
  // ---------------------------------------------------------------------
  const BUDGET_TIERS = [
    { level: 1, symbol: '₹', label: 'Budget', min: 100, max: 300 },
    { level: 2, symbol: '₹₹', label: 'Moderate', min: 250, max: 600 },
    { level: 3, symbol: '₹₹₹', label: 'Premium', min: 500, max: 1000 },
    { level: 4, symbol: '₹₹₹₹', label: 'Luxury', min: 900, max: 2000 }
  ];

  function estimateBudget(place) {
    const rng = makeSeededRng(seedFor(place) + '-budget');
    const level = clamp(typeof place.price_level === 'number' ? place.price_level : 2, 1, 4);
    const tier = BUDGET_TIERS[level - 1];
    const avg = Math.round((tier.min + rng() * (tier.max - tier.min)) / 10) * 10;
    return {
      level: tier.level,
      symbol: tier.symbol,
      label: tier.label,
      avgCostPerPerson: avg,
      rangeLabel: `₹${tier.min}–₹${tier.max}`
    };
  }

  function matchesBudgetBracket(estimate, bracketKey) {
    const v = estimate.avgCostPerPerson;
    switch (bracketKey) {
      case 'under200': return v < 200;
      case '200-500': return v >= 200 && v <= 500;
      case '500-1000': return v > 500 && v <= 1000;
      case '1000plus': return v > 1000;
      default: return true;
    }
  }

  // ---------------------------------------------------------------------
  // 4. PEAK HOUR ANALYSIS + 5. CROWD PREDICTION
  // REPLACEABLE: swap for real Google "Popular Times" data when available.
  // ---------------------------------------------------------------------
  function generatePeakProfile(place) {
    const rng = makeSeededRng(seedFor(place) + '-peak');
    // Slight variation per cafe so the whole list doesn't look identical.
    const morningStart = 7 + Math.round(rng() * 2); // 7-9
    const morningEnd = morningStart + 2;
    const eveningStart = 16 + Math.round(rng() * 2); // 16-18
    const eveningEnd = eveningStart + 3;
    return {
      windows: [
        { startHour: morningStart, endHour: morningEnd, label: formatHourRange(morningStart, morningEnd) },
        { startHour: eveningStart, endHour: eveningEnd, label: formatHourRange(eveningStart, eveningEnd) }
      ],
      bestWindow: { startHour: morningEnd + 1, endHour: eveningStart - 1, label: formatHourRange(morningEnd + 1, eveningStart - 1) }
    };
  }

  function formatHourRange(startHour, endHour) {
    return `${formatHour(startHour)} – ${formatHour(endHour)}`;
  }
  function formatHour(h) {
    const hh = ((h % 24) + 24) % 24;
    const period = hh >= 12 ? 'PM' : 'AM';
    let display = hh % 12;
    if (display === 0) display = 12;
    return `${display}:00 ${period}`;
  }

  function loadLevelForHour(peakProfile, hour) {
    for (const w of peakProfile.windows) {
      if (hour >= w.startHour && hour < w.endHour) return 'High';
      if (hour === w.startHour - 1 || hour === w.endHour) return 'Moderate';
    }
    return 'Low';
  }

  const LOAD_META = {
    Low: { emoji: '🟢', color: '#16a34a' },
    Moderate: { emoji: '🟡', color: '#d97706' },
    High: { emoji: '🔴', color: '#dc2626' }
  };

  function predictCrowd(place, now) {
    now = now || new Date();
    const peak = generatePeakProfile(place);
    const hourNow = now.getHours();
    const current = loadLevelForHour(peak, hourNow);
    const in1h = loadLevelForHour(peak, (hourNow + 1) % 24);
    const in3h = loadLevelForHour(peak, (hourNow + 3) % 24);
    return {
      peak,
      current: { level: current, ...LOAD_META[current] },
      in1h: { level: in1h, ...LOAD_META[in1h] },
      in3h: { level: in3h, ...LOAD_META[in3h] }
    };
  }

  // ---------------------------------------------------------------------
  // 6. MOST ORDERED ITEMS ("Top Picks") + 7. SIGNATURE ITEMS ("Must Try")
  // REPLACEABLE: swap with real POS/menu data when available.
  // ---------------------------------------------------------------------
  const COMMON_ITEMS = [
    'Cappuccino', 'Cafe Latte', 'Cold Brew', 'Hazelnut Latte', 'Filter Coffee',
    'Americano', 'Iced Mocha', 'Masala Chai', 'Croissant', 'Blueberry Cheesecake',
    'Avocado Toast', 'Club Sandwich', 'Pasta Alfredo', 'Brownie', 'Lemonade'
  ];
  const SIGNATURE_ITEMS = [
    'Vietnamese Coffee', 'Tiramisu', 'Mocha Shake', 'Affogato', 'Sea Salt Latte',
    'Burnt Caramel Cold Brew', 'Belgian Waffle', 'Matcha Latte', 'Filter Kaapi',
    'Dark Chocolate Lava Cake', "Chef's Special Cold Coffee", 'Rose Pistachio Latte'
  ];

  function pickUnique(pool, rng, count) {
    const copy = pool.slice();
    const out = [];
    while (out.length < count && copy.length) {
      const idx = Math.floor(rng() * copy.length);
      out.push(copy.splice(idx, 1)[0]);
    }
    return out;
  }

  function generateMenuHighlights(place) {
    const rng = makeSeededRng(seedFor(place) + '-menu');
    return {
      topPicks: pickUnique(COMMON_ITEMS, rng, 4),
      mustTry: pickUnique(SIGNATURE_ITEMS, rng, 3)
    };
  }

  // ---------------------------------------------------------------------
  // 8. AI REVIEW SUMMARIZATION
  // REPLACEABLE: swap the body for an LLM call over `place.reviews`.
  // ---------------------------------------------------------------------
  function summarizeReviews(place) {
    const reviewText = collectReviewText(place);
    if (!reviewText) {
      // No review text available from this API call — fall back to a
      // rating/price-driven generic but still useful summary.
      const rating = place.rating || 4.2;
      const tone = rating >= 4.5 ? 'Highly rated by visitors' : rating >= 4.0 ? 'Generally well liked' : 'Mixed feedback from visitors';
      return {
        positives: ['Coffee quality', 'Ambience'],
        complaints: ['Limited data — open the listing for full reviews'],
        summary: `${tone}. Full review text wasn't available for this listing, so this summary is based on its overall rating and price tier.`
      };
    }

    const positives = [];
    if (countMatches(reviewText, LEXICON.tastePositive) > 0) positives.push('Coffee & food quality');
    if (countMatches(reviewText, LEXICON.ambiencePositive) > 0 || countMatches(reviewText, LEXICON.romantic) > 0) positives.push('Ambience');
    if (countMatches(reviewText, LEXICON.service) > countMatches(reviewText, LEXICON.slowService)) positives.push('Service');
    if (countMatches(reviewText, LEXICON.quiet) > 0) positives.push('Comfortable seating / quiet space');
    if (!positives.length) positives.push('Overall experience');

    const complaints = [];
    if (countMatches(reviewText, LEXICON.slowService) > 0) complaints.push('Slow service during peak hours');
    if (countMatches(reviewText, LEXICON.parkingIssue) > 0) complaints.push('Limited parking');
    if (countMatches(reviewText, LEXICON.priceComplaint) > 0) complaints.push('On the pricier side');
    if (countMatches(reviewText, LEXICON.noisy) > 0) complaints.push('Can get noisy/crowded');
    if (!complaints.length) complaints.push('No major recurring complaints found');

    const summary = `Customers love the ${positives.join(', ').toLowerCase()}. ${complaints[0] !== 'No major recurring complaints found' ? 'Common complaints include ' + complaints.join(', ').toLowerCase() + '.' : 'No major recurring complaints found in available reviews.'}`;

    return { positives, complaints, summary };
  }

  // ---------------------------------------------------------------------
  // 9. RATING BREAKDOWN (simulated distribution — Places JS API doesn't
  // expose the real per-star histogram)
  // ---------------------------------------------------------------------
  function ratingBreakdown(place) {
    const rating = place.rating || 4.2;
    const rng = makeSeededRng(seedFor(place) + '-stars');
    // Skew a distribution so its weighted average ~= rating
    const weights = [5, 4, 3, 2, 1].map(star => {
      const closeness = 1 - Math.abs(star - rating) / 4;
      return Math.max(0.02, closeness + rng() * 0.08);
    });
    const total = weights.reduce((a, b) => a + b, 0);
    return [5, 4, 3, 2, 1].map((star, i) => ({
      star,
      pct: Math.round((weights[i] / total) * 100)
    }));
  }

  // ---------------------------------------------------------------------
  // 10. PERSONALIZED SEARCH PROFILES
  // ---------------------------------------------------------------------
  const PROFILES = {
    student: { label: 'Student', emoji: '🎓', primaryScore: 'student' },
    remote_worker: { label: 'Remote Worker', emoji: '💻', primaryScore: 'work' },
    family: { label: 'Family', emoji: '👨‍👩‍👧‍👦', primaryScore: 'family' },
    couple: { label: 'Couple', emoji: '❤️', primaryScore: 'date' },
    friends_group: { label: 'Friends Group', emoji: '👥', primaryScore: 'group' },
    business_professional: { label: 'Business Professional', emoji: '🤝', primaryScore: 'meeting' }
  };

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------
  global.CafeIntel = {
    scoreCafe,
    overallScore,
    bestForTags,
    CATEGORY_META,
    studyReason,
    meetingReason,
    estimateBudget,
    matchesBudgetBracket,
    generatePeakProfile,
    predictCrowd,
    LOAD_META,
    generateMenuHighlights,
    summarizeReviews,
    ratingBreakdown,
    PROFILES
  };
})(window);
