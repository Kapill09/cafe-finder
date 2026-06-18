/* global google, markerClusterer */
// Full app.js embedded inline
      /* global google, markerClusterer */
const state = {
    map: null,
    userMarker: null,
    placeMarkers: [],
    markerClusterer: null,
    placesService: null,
    autocomplete: null,
    directionsService: null,
    directionsRenderer: null,
    userLocation: null,
    lastResults: [],
    isOnline: navigator.onLine,
    currentCategoryType: null,
    miniTagLoaded: new Set(),
    placeIdToMarker: {},
    isSearching: false,
    googleMapsReady: false,
    googleMapsFailed: false,
    lastPlacesStatus: null,
    uiBound: false
  };

  const fallbackPlaces = [
    {
      name: 'Blue Tokai Coffee Roasters',
      vicinity: 'Connaught Place, New Delhi',
      rating: 4.5,
      price_level: 2,
      types: ['cafe'],
      geometry: { location: { lat: 28.6328, lng: 77.2197 } },
      place_id: '',
      distanceMeters: 1800,
      user_ratings_total: 2400,
      opening_hours: { open_now: true }
    },
    {
      name: 'The Big Chill Cafe',
      vicinity: 'Khan Market, New Delhi',
      rating: 4.4,
      price_level: 3,
      types: ['restaurant', 'cafe'],
      geometry: { location: { lat: 28.6006, lng: 77.2276 } },
      place_id: '',
      distanceMeters: 3200,
      user_ratings_total: 5600,
      opening_hours: { open_now: true }
    },
    {
      name: 'Sardar-Ji-Bakhsh Coffee',
      vicinity: 'Rajouri Garden, New Delhi',
      rating: 4.2,
      price_level: 2,
      types: ['cafe'],
      geometry: { location: { lat: 28.6417, lng: 77.1209 } },
      place_id: '',
      distanceMeters: 6200,
      user_ratings_total: 1300,
      opening_hours: { open_now: false }
    },
    {
      name: 'Ama Cafe',
      vicinity: 'Majnu-ka-tilla, New Delhi',
      rating: 4.6,
      price_level: 2,
      types: ['cafe', 'bakery'],
      geometry: { location: { lat: 28.7027, lng: 77.2280 } },
      place_id: '',
      distanceMeters: 9700,
      user_ratings_total: 7900,
      opening_hours: { open_now: true }
    }
  ];
  
  window.addEventListener('online', () => updateOnlineStatus(true));
  window.addEventListener('offline', () => updateOnlineStatus(false));
  
  function updateOnlineStatus(isOnline) {
    state.isOnline = isOnline;
    const badge = document.getElementById('statusBadge');
    if (!badge) return;
    if (isOnline) {
      badge.textContent = '🟢 Online';
      badge.className = 'text-sm px-4 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium';
    } else {
      badge.textContent = '🔴 Offline';
      badge.className = 'text-sm px-4 py-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium';
    }
  }
  
  // Initialize map
  async function initMap() {
    updateOnlineStatus(navigator.onLine);
    state.googleMapsReady = true;
  
    // Default view: Delhi
    const defaultCenter = { lat: 28.6139, lng: 77.2090 };
  
    state.map = new google.maps.Map(document.getElementById('map'), {
      center: defaultCenter,
      zoom: 5,
      fullscreenControl: false,
      mapTypeControl: false,
      streetViewControl: false,
      styles: [
        {
          featureType: 'poi',
          elementType: 'labels',
          stylers: [{ visibility: 'off' }]
        }
      ]
    });
  
    state.placesService = new google.maps.places.PlacesService(state.map);
    state.directionsService = new google.maps.DirectionsService();
    state.directionsRenderer = new google.maps.DirectionsRenderer({ 
      map: state.map, 
      suppressMarkers: false,
      polylineOptions: {
        strokeColor: '#c94836',
        strokeOpacity: 0.8,
        strokeWeight: 4
      }
    });
  
    // Initialize search area button
    const searchAreaBtn = document.getElementById('searchAreaBtn');
    if (searchAreaBtn) {
      searchAreaBtn.classList.add('hidden');
      
      state.map.addListener('dragend', () => {
        searchAreaBtn.classList.remove('hidden');
      });
      state.map.addListener('zoom_changed', () => {
        searchAreaBtn.classList.remove('hidden');
      });
  
      searchAreaBtn.addEventListener('click', async () => {
        searchAreaBtn.classList.add('hidden');
        await findNearbyCafes(state.map.getCenter().toJSON(), state.currentCategoryType || undefined);
      });
    }
  
    bindUI();
    await locateUser();
    if (state.userLocation) {
      state.map.setCenter(state.userLocation);
    }
  
    // If offline, load last results
    if (!state.isOnline) {
      const cached = loadCachedResults();
      if (cached?.results?.length) {
        state.lastResults = cached.results;
        renderResults(cached.results, cached.userLocation || state.userLocation);
      }
      return;
    }
  
    // Initial nearby fetch
    await findNearbyCafes();
  }
  
  
  function setupAutocomplete() {
    // Setup Places Autocomplete on the search input for suggestions
    const input = document.getElementById('queryInput');
    if (input && !state.autocomplete && window.google?.maps?.places?.Autocomplete && state.map) {
      state.autocomplete = new google.maps.places.Autocomplete(input, {
        fields: ['place_id', 'geometry', 'name', 'formatted_address', 'types'],
        componentRestrictions: { country: 'in' }
      });
      state.autocomplete.bindTo('bounds', state.map);
      state.autocomplete.addListener('place_changed', () => {
        const place = state.autocomplete.getPlace();
        if (place && place.geometry && place.geometry.location) {
          const loc = place.geometry.location;
          try { 
            state.map.setCenter(loc);
            state.map.setZoom(14); 
          } catch {}
          findNearbyCafes(loc.toJSON());
        } else {
          findNearbyCafes();
        }
      });
    }
  }

  function bindUI() {
    setupAutocomplete();
    if (state.uiBound) return;
    state.uiBound = true;
  
    document.getElementById('locateBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('locateBtn');
      const originalText = btn.textContent;
      btn.textContent = '⏳ Getting location...';
      btn.disabled = true;
      
      await locateUser();
      
      btn.textContent = originalText;
      btn.disabled = false;
      
      if (state.userLocation) {
        state.map.setCenter(state.userLocation);
        state.map.setZoom(13);
        await findNearbyCafes();
      } else {
        const msg = navigator.geolocation
          ? 'Unable to get your location. Please check permissions and try again.'
          : 'Geolocation not supported in your browser.';
        alert(msg);
      }
    });
  
    document.getElementById('nearbyBtn')?.addEventListener('click', async () => {
      if (!state.userLocation) {
        alert('Please use "Use my location" first to find nearby cafés.');
        return;
      }
      await findNearbyCafes(state.userLocation);
    });
  
    document.getElementById('searchBtn')?.addEventListener('click', async () => {
      await findNearbyCafes();
    });
  
    const input = document.getElementById('queryInput');
    // Enter-to-search and debounce typing
    if (input) {
  let debounceTimer = null;

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(debounceTimer);
      findNearbyCafes();
    }
  });

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      findNearbyCafes();
    }, 800);
  });
}
  
    // Category chips
    document.querySelectorAll('.cat-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cat-chip').forEach(b => {
          b.classList.remove('bg-coffee-100', 'border-coffee-400', 'text-coffee-900');
        });
        btn.classList.add('bg-coffee-100', 'border-coffee-400', 'text-coffee-900');
        
        const query = btn.getAttribute('data-query') || '';
        const type = btn.getAttribute('data-type') || '';
        const qInput = document.getElementById('queryInput');
        if (qInput) qInput.value = query;
        state.currentCategoryType = type || null;
        findNearbyCafes(undefined, state.currentCategoryType || undefined);
      });
    });
  
    // Filter listeners
    ['priceFilter', 'ratingFilter', 'wifiFilter', 'openNowFilter', 'radiusFilter'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        findNearbyCafes();
      });
    });
  }
  
  function locateUser() {
    return new Promise(resolve => {
      if (!navigator.geolocation) {
        console.warn('Geolocation not supported');
        return resolve(null);
      }
      
      state.userLocation = null;
      if (state.userMarker) {
        state.userMarker.setMap(null);
        state.userMarker = null;
      }
      
      navigator.geolocation.getCurrentPosition(
        pos => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          state.userLocation = coords;
          
          state.userMarker = new google.maps.Marker({
            position: coords,
            map: state.map,
            title: 'Your location',
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: '#c94836',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 3,
              label: '📍'
            },
            zIndex: 1000
          });
          
          state.map.setCenter(coords);
          state.map.setZoom(13);
          
          resolve(coords);
        },
        err => {
          console.warn('Geolocation error:', err);
          resolve(null);
        },
        { 
          enableHighAccuracy: true, 
          maximumAge: 0,
          timeout: 15000
        }
      );
    });
  }
  
  async function findNearbyCafes(forcedLocation, categoryType) {
    if (state.isSearching) return;
    if (!state.googleMapsReady || !state.map || !state.placesService) {
      renderFallbackResults('Live Google Maps/Places is not available. Showing sample restaurants until the API key is fixed.');
      return;
    }
    if (!state.isOnline) {
      showSkeletons(false);
      const cached = loadCachedResults();
      if (cached?.results?.length) {
        renderResults(cached.results, cached.userLocation || state.userLocation);
      }
      return;
    }
    
    state.isSearching = true;
    showSkeletons(true);
  
    try {
      const keyword = document.getElementById('queryInput')?.value?.trim() || '';
      const priceStr = document.getElementById('priceFilter')?.value || '';
      const minRating = parseFloat(document.getElementById('ratingFilter')?.value || '0');
      const preferWifi = document.getElementById('wifiFilter')?.checked || false;
      const openNow = document.getElementById('openNowFilter')?.checked || false;
      let radius = parseInt(document.getElementById('radiusFilter')?.value || '2000', 10);
    
      const location = forcedLocation || state.userLocation || state.map.getCenter().toJSON();
    
      // Smart radius calculation from map bounds
      try {
        const bounds = state.map.getBounds();
        if (bounds) {
          const center = bounds.getCenter();
          const ne = bounds.getNorthEast();
          const meters = google.maps.geometry.spherical.computeDistanceBetween(center, ne);
          radius = Math.min(Math.max(Math.round(meters * 1.2), 500), 25000);
        }
      } catch {}
    
      // Search logic
      let results = [];
      
      if (keyword.length > 0 && state.placesService?.textSearch) {
        const textReq = {
          location,
          radius,
          query: keyword,
          type: categoryType || undefined,
          openNow: openNow || undefined
        };
        results = await textSearchAsync(textReq);
      }
      
      if (!results || results.length === 0) {
        const searchType = categoryType || keyword || 'restaurant';
        const nearbyReq = {
          location,
          radius,
          keyword: searchType,
          type: searchType,
          openNow: openNow || undefined
        };
        results = await nearbySearchAsync(nearbyReq);
      }
      
      if (!results || results.length === 0) {
        if (state.lastPlacesStatus && state.lastPlacesStatus !== google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
          renderFallbackResults(`Google Places returned ${state.lastPlacesStatus}. Showing sample restaurants until the Maps API key, billing, and Places API access are fixed.`);
          return;
        }
        const fallbackReq = {
          location,
          radius: Math.min(radius * 1.5, 25000),
          keyword: 'cafe restaurant',
          type: 'restaurant',
          openNow: false
        };
        results = await nearbySearchAsync(fallbackReq);
      }
    
      // Client-side filtering
      let filtered = (results || []).filter(r => {
        const rating = r.rating || 0;
        if (rating < minRating) return false;
        
        if (priceStr) {
          const price = parseInt(priceStr, 10);
          if (r.price_level !== price) return false;
        }
        
        if (preferWifi && !(r.types || []).includes('internet_cafe')) {
          return false;
        }
        
        return true;
      });
    
      // Enrich with distance
      const withDistance = filtered.map(place => {
        const distanceMeters = google.maps.geometry && location
          ? google.maps.geometry.spherical.computeDistanceBetween(
              new google.maps.LatLng(location.lat, location.lng),
              place.geometry.location
            )
          : null;
        return { ...place, distanceMeters };
      });
    
      // Sort by distance
      withDistance.sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
    
      state.lastResults = withDistance;
      cacheResults(withDistance, location);
      renderResults(withDistance, location);
      addMarkers(withDistance);
      
    } catch (error) {
      console.error('Search error:', error);
      showEmptyState(true, 'An error occurred while searching. Please try again.');
    } finally {
      state.isSearching = false;
      showSkeletons(false);
    }
  }
  
  function nearbySearchAsync(request) {
    return new Promise(resolve => {
      if (!state.placesService?.nearbySearch) return resolve([]);
      state.placesService.nearbySearch(request, (results, status) => {
        state.lastPlacesStatus = status;
        if (status !== google.maps.places.PlacesServiceStatus.OK || !results) {
          resolve([]);
          return;
        }
        resolve(results);
      });
    });
  }
  
  function textSearchAsync(request) {
    return new Promise(resolve => {
      if (!state.placesService?.textSearch) return resolve([]);
      state.placesService.textSearch(request, (results, status) => {
        state.lastPlacesStatus = status;
        if (status !== google.maps.places.PlacesServiceStatus.OK || !results) {
          resolve([]);
          return;
        }
        resolve(results);
      });
    });
  }
  
  function addMarkers(places) {
    try { state.directionsRenderer.set('directions', null); } catch {}
    if (state.markerClusterer) {
      state.markerClusterer.clearMarkers();
      state.markerClusterer = null;
    }
    state.placeMarkers.forEach(m => m.setMap(null));
    state.placeMarkers = [];
    state.placeIdToMarker = {};
  
    const info = new google.maps.InfoWindow();
    places.slice(0, 200).forEach((place, index) => {
      if (!place.geometry?.location) return;
      
      const marker = new google.maps.Marker({
        position: place.geometry.location,
        map: state.map,
        title: place.name,
        animation: google.maps.Animation.DROP,
        label: {
          text: (index + 1).toString(),
          color: '#fff',
          fontSize: '14px',
          fontWeight: 'bold'
        }
      });
      
      marker.addListener('click', () => {
        const priceText = typeof place.price_level === 'number' ? '₹'.repeat(place.price_level) : '—';
        const ratingText = place.rating != null ? place.rating.toFixed(1) : '—';
        const distanceText = place.distanceMeters != null
          ? (place.distanceMeters < 1000 ? `${Math.round(place.distanceMeters)} m` : `${(place.distanceMeters / 1000).toFixed(1)} km`)
          : '';
        
        info.setContent(
          `<div class="min-w-[220px] text-coffee-900">
            <div class="font-bold text-base mb-1">${place.name || ''}</div>
            <div class="text-xs text-coffee-600 mb-2">${place.vicinity || place.formatted_address || ''}</div>
            <div class="flex items-center gap-3 text-xs">
              <span>⭐ ${ratingText}</span>
              <span>${priceText || '—'}</span>
              <span>📍 ${distanceText}</span>
            </div>
          </div>`
        );
        info.open({ map: state.map, anchor: marker });
      });
      
      state.placeMarkers.push(marker);
      if (place.place_id) state.placeIdToMarker[place.place_id] = marker;
    });
  
    // Cluster markers if enough of them
    if (places.length > 10) {
      try {
        state.markerClusterer = new markerClusterer.MarkerClusterer({ 
          map: state.map, 
          markers: state.placeMarkers,
          algorithm: new markerClusterer.GridAlgorithm({ maxZoom: 15 })
        });
      } catch {}
    }
  }
  
  function renderResults(places, origin) {
    const container = document.getElementById('results');
    const count = document.getElementById('resultCount');
    const emptyState = document.getElementById('emptyState');
    
    if (!container) return;
  
    container.innerHTML = '';
    if (count) count.textContent = String(places.length);
    
    if (!places || places.length === 0) {
      showEmptyState(true);
      return;
    }
    
    showEmptyState(false);
  
    places.forEach((place, index) => {
      const fallbackUrl = 'https://images.unsplash.com/photo-1501339847302-ac426a36ae57?q=80&w=1200&auto=format&fit=crop';
      const initialUrl = (place.photos && place.photos.length > 0) 
        ? place.photos[0].getUrl({ maxWidth: 600, maxHeight: 400 })
        : fallbackUrl;
  
      const distanceText = place.distanceMeters != null
        ? (place.distanceMeters < 1000 
          ? `${Math.round(place.distanceMeters)} m` 
          : `${(place.distanceMeters / 1000).toFixed(1)} km`)
        : '';
  
      const priceText = typeof place.price_level === 'number' ? '₹'.repeat(place.price_level) : 'N/A';
      const ratingStars = renderStars(place.rating);
      const reviewCount = place.user_ratings_total || 0;
      
      const card = document.createElement('div');
      card.className = 'result-card group overflow-hidden rounded-xl border border-coffee-200 hover:border-brand-500 bg-white shadow-md hover:shadow-lg transition-all';
      card.innerHTML = `
        <div class="flex gap-4 p-4">
          <img src="${initialUrl}" alt="${place.name}" class="w-28 h-28 object-cover rounded-lg flex-shrink-0 group-hover:brightness-110 transition">
          <div class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-2 mb-1">
              <h3 class="font-bold text-lg text-coffee-900 truncate hover:underline cursor-pointer details-link">${place.name || 'Cafe'}</h3>
              <span class="text-xs font-semibold text-coffee-600 whitespace-nowrap ml-2">#${index + 1}</span>
            </div>
            <div class="text-sm text-coffee-600 line-clamp-1 mb-2">${place.vicinity || place.formatted_address || ''}</div>
            
            <div class="flex flex-wrap items-center gap-2 mb-3">
              <span class="badge badge-rating">${ratingStars} ${place.rating != null ? place.rating.toFixed(1) : 'N/A'}</span>
              <span class="badge badge-price">${priceText}</span>
              ${place.opening_hours?.open_now ? '<span class="badge badge-open">🟢 Open now</span>' : '<span class="text-xs text-coffee-500">Closed</span>'}
              ${(place.types || []).includes('restaurant') ? '<span class="badge badge-type">🍽️ Restaurant</span>' : '<span class="badge badge-type">☕ Cafe</span>'}
            </div>
            
            <div class="flex items-center gap-2 text-sm text-coffee-600 mb-3">
              <span>📍 ${distanceText}</span>
              <span>•</span>
              <span>💬 ${reviewCount} reviews</span>
            </div>
            
            <div class="flex flex-wrap gap-2">
              <button class="dir-btn btn-primary px-4 py-2 rounded-lg bg-gradient-to-r from-brand-500 to-coffee-600 hover:from-brand-600 hover:to-coffee-700 text-white text-sm font-semibold transition">📍 Directions</button>
              <a class="px-4 py-2 rounded-lg border border-coffee-300 text-sm font-medium text-coffee-700 hover:bg-coffee-50 transition smooth-transition" href="${getMapsUrl(place)}" target="_blank" rel="noopener">🗺️ Maps</a>
            </div>
          </div>
        </div>
      `;
  
      const imgEl = card.querySelector('img');
      if (imgEl && imgEl.src === fallbackUrl) {
        tryLoadPlacePhoto(place.place_id, imgEl);
      }
      
      card.querySelector('.details-link')?.addEventListener('click', () => {
        if (!place.place_id || !state.map) return;
        showPlaceDetails(place.place_id, place.name);
        const m = place.place_id ? state.placeIdToMarker[place.place_id] : null;
        if (m) {
          state.map.panTo(m.getPosition());
          m.setAnimation(google.maps.Animation.BOUNCE);
          setTimeout(() => m.setAnimation(null), 700);
        }
      });
  
      card.querySelector('.dir-btn')?.addEventListener('click', () => {
        if (!origin || !state.directionsService || !place.geometry?.location?.toJSON) {
          window.open(getMapsUrl(place), '_blank', 'noopener');
          return;
        }
        showDirections(origin, place.geometry.location.toJSON());
      });
  
      container.appendChild(card);
    });
  }

  function getMapsUrl(place) {
    const query = encodeURIComponent(`${place.name || 'restaurant'} ${place.vicinity || ''}`);
    return place.place_id
      ? `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${place.place_id}`
      : `https://www.google.com/maps/search/?api=1&query=${query}`;
  }

  function renderFallbackResults(message) {
    state.googleMapsFailed = true;
    state.isSearching = false;
    showSkeletons(false);
    showMapMessage(message);

    const origin = state.userLocation || { lat: 28.6139, lng: 77.2090 };
    const keyword = document.getElementById('queryInput')?.value?.trim().toLowerCase() || '';
    const minRating = parseFloat(document.getElementById('ratingFilter')?.value || '0');
    const priceStr = document.getElementById('priceFilter')?.value || '';
    const openNow = document.getElementById('openNowFilter')?.checked || false;

    const filtered = fallbackPlaces.filter(place => {
      const haystack = `${place.name} ${place.vicinity} ${(place.types || []).join(' ')}`.toLowerCase();
      if (keyword && !haystack.includes(keyword)) return false;
      if ((place.rating || 0) < minRating) return false;
      if (priceStr && place.price_level !== parseInt(priceStr, 10)) return false;
      if (openNow && !place.opening_hours?.open_now) return false;
      return true;
    });

    renderResults(filtered, origin);
  }

  function showMapMessage(message) {
    const mapEl = document.getElementById('map');
    if (!mapEl) return;
    mapEl.innerHTML = `
      <div class="h-full w-full grid place-content-center bg-coffee-50 text-center p-8">
        <div class="mx-auto mb-4 h-12 w-12 rounded-full bg-amber-100 text-amber-700 grid place-content-center font-bold">!</div>
        <h3 class="text-xl font-bold text-coffee-900 mb-2">Google Maps did not load</h3>
        <p class="text-sm text-coffee-700 max-w-sm">${message}</p>
      </div>
    `;
  }
  
  function showEmptyState(show, message = null) {
    const emptyState = document.getElementById('emptyState');
    const results = document.getElementById('results');
    if (!emptyState || !results) return;
    
    if (show) {
      emptyState.classList.remove('hidden');
      results.classList.add('hidden');
      
      if (message) {
        emptyState.innerHTML = `
          <div class="text-6xl mb-4">☕</div>
          <h3 class="text-xl font-bold text-coffee-900 mb-2">No cafés found</h3>
          <p class="text-coffee-600 mb-6 max-w-sm">${message}</p>
          <div class="space-y-2 text-sm text-coffee-700">
            <button class="block text-brand-600 hover:text-brand-700 font-medium">↑ Increase search radius</button>
            <button class="block text-brand-600 hover:text-brand-700 font-medium">↓ Lower rating filter</button>
            <button class="block text-brand-600 hover:text-brand-700 font-medium">🔄 Remove filters</button>
          </div>
        `;
      }
    } else {
      emptyState.classList.add('hidden');
      results.classList.remove('hidden');
    }
  }
  
  function showDirections(origin, destination) {
    state.directionsService.route(
      {
        origin,
        destination,
        travelMode: google.maps.TravelMode.WALKING
      },
      (result, status) => {
        if (status === google.maps.DirectionsStatus.OK) {
          state.directionsRenderer.setDirections(result);
        } else {
          alert('Unable to get directions. Please try again.');
        }
      }
    );
  }
  
  function cacheResults(results, userLocation) {
    try {
      const toStore = results.map(r => ({
        name: r.name,
        vicinity: r.vicinity,
        rating: r.rating,
        price_level: r.price_level,
        types: r.types,
        geometry: { location: r.geometry.location.toJSON() },
        place_id: r.place_id,
        distanceMeters: r.distanceMeters,
        user_ratings_total: r.user_ratings_total,
        opening_hours: r.opening_hours
      }));
      localStorage.setItem('lastCafeResults', JSON.stringify({ results: toStore, userLocation, timestamp: Date.now() }));
    } catch (e) {
      console.warn('Cache error:', e);
    }
  }
  
  function loadCachedResults() {
    try {
      const raw = localStorage.getItem('lastCafeResults');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const age = Date.now() - (parsed.timestamp || 0);
      if (age > 3600000) return null; // 1 hour cache
      parsed.results = parsed.results.map(r => ({
        ...r,
        geometry: { location: new google.maps.LatLng(r.geometry.location.lat, r.geometry.location.lng) }
      }));
      return parsed;
    } catch {
      return null;
    }
  }
  
  function tryLoadPlacePhoto(placeId, imgEl) {
    if (!placeId || !state.placesService?.getDetails) return;
    state.placesService.getDetails({ placeId, fields: ['photos'] }, (place, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !place || !place.photos || !place.photos.length) return;
      try {
        const url = place.photos[0].getUrl({ maxWidth: 800, maxHeight: 600 });
        if (url && imgEl) imgEl.src = url;
      } catch (e) {
        console.warn('Photo load error:', e);
      }
    });
  }
  
  function openModal(contentHtml, title) {
    const modal = document.getElementById('detailsModal');
    const body = document.getElementById('detailsBody');
    const heading = document.getElementById('detailsTitle');
    if (!modal || !body || !heading) return;
    heading.textContent = title || 'Details';
    body.innerHTML = contentHtml || '';
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.style.overflow = 'hidden';
  }
  
  function closeModal() {
    const modal = document.getElementById('detailsModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.body.style.overflow = '';
  }
  
  document.getElementById('detailsClose')?.addEventListener('click', closeModal);
  
  document.getElementById('detailsModal')?.addEventListener('click', e => {
    if (e.target && e.target === document.getElementById('detailsModal')) closeModal();
  });
  
  function showSkeletons(show) {
    const res = document.getElementById('results');
    const sk = document.getElementById('resultsSkeleton');
    const empty = document.getElementById('emptyState');
    if (!res || !sk) return;
    if (show) { 
      sk.classList.remove('hidden'); 
      res.classList.add('hidden');
      if (empty) empty.classList.add('hidden');
    } else { 
      sk.classList.add('hidden'); 
      res.classList.remove('hidden');
    }
  }
  
  function renderStars(rating) {
    if (!rating) return '☆☆☆☆☆';
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);
    return '★'.repeat(Math.min(fullStars, 5)) + (hasHalfStar ? '★' : '') + '☆'.repeat(Math.max(emptyStars, 0));
  }
  
  function initHero() {
    const startBtn = document.getElementById('startSearchBtn');
    const heroSection = document.getElementById('heroSection');
    const mainContent = document.getElementById('mainContent');
    const searchSection = document.getElementById('searchSection');
    const mainHeader = document.getElementById('mainHeader');
    
    if (startBtn && heroSection && mainContent && searchSection && mainHeader) {
      startBtn.addEventListener('click', () => {
        heroSection.style.display = 'none';
        mainHeader.style.display = 'none';
        mainContent.classList.remove('hidden');
        searchSection.classList.remove('hidden');
      });
    }
  }
  
  function init() {
    initHero();
    bindUI();
    loadGoogleMapsScript();
  }
  
  // Check if DOM is already loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function loadGoogleMapsScript() {
    const apiKey = getGoogleMapsApiKey();
    
    if (!apiKey) {
      renderFallbackResults('Google Maps API key is missing. Add it to src/config.js or open the page with ?googleMapsKey=YOUR_KEY.');
      return;
    }
    
    if (document.getElementById('google-maps-script')) return;
    const script = document.createElement('script');
    script.id = 'google-maps-script';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry,marker&callback=initMap`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      renderFallbackResults('The Google Maps script could not be downloaded. Check your network connection or API key restrictions.');
    };
    document.body.appendChild(script);
  }

  window.initMap = initMap;
  window.gm_authFailure = () => {
    renderFallbackResults(`Google rejected the Maps API key for ${getCurrentOriginLabel()}. Enable Maps JavaScript API and Places API, turn on billing, and allow this origin in key restrictions.`);
  };

  function getGoogleMapsApiKey() {
    const params = new URLSearchParams(window.location.search);
    const keyFromUrl = params.get('googleMapsKey');
    if (keyFromUrl) {
      localStorage.setItem('googleMapsApiKey', keyFromUrl.trim());
      return keyFromUrl.trim();
    }

    const keyFromStorage = localStorage.getItem('googleMapsApiKey');
    if (keyFromStorage) return keyFromStorage.trim();

    return (window.GOOGLE_MAPS_API_KEY || '').trim();
  }

  function getCurrentOriginLabel() {
    if (window.location.protocol === 'file:') return 'file:// pages';
    return window.location.origin;
  }
  
  function showPlaceDetails(placeId, placeName) {
    if (!state.placesService) return;
    
    state.placesService.getDetails(
      {
        placeId,
        fields: ['name', 'formatted_address', 'formatted_phone_number', 'opening_hours', 'rating', 'user_ratings_total', 'url', 'photos', 'price_level', 'reviews', 'website']
      },
      (place, status) => {
        if (status !== google.maps.places.PlacesServiceStatus.OK || !place) {
          console.warn('Place details error:', status);
          return;
        }

        let photosHtml = '';
        if (place.photos && place.photos.length > 0) {
          photosHtml = '<div class="grid grid-cols-2 gap-3 mb-5">';
          place.photos.slice(0, 4).forEach(photo => {
            const url = photo.getUrl({ maxWidth: 300, maxHeight: 300 });
            photosHtml += `<img src="${url}" alt="Photo" class="w-full h-32 object-cover rounded-lg" />`;
          });
          photosHtml += '</div>';
        }

        const hours = place.opening_hours?.weekday_text || [];
        const hoursHtml = hours.length > 0 
          ? `<div class="space-y-1 text-sm"><strong>Hours:</strong><div class="text-coffee-600">${hours.join('<br>')}</div></div>`
          : '';

        const reviewsHtml = place.reviews && place.reviews.length > 0
          ? `<div class="space-y-3 mt-4">
              <strong>Recent Reviews:</strong>
              ${place.reviews.slice(0, 3).map(review => `
                <div class="border-l-2 border-brand-500 pl-3 py-2">
                  <div class="flex items-center gap-2 text-sm">
                    <strong>${review.author_name}</strong>
                    <span class="text-xs text-coffee-600">${review.relative_time_description}</span>
                  </div>
                  <div class="text-sm text-coffee-600">${'★'.repeat(review.rating)}${'☆'.repeat(5-review.rating)}</div>
                  <p class="text-sm mt-1 text-coffee-700">${review.text.substring(0, 150)}...</p>
                </div>
              `).join('')}
            </div>`
          : '';

        const priceText = place.price_level ? '₹'.repeat(place.price_level) : 'N/A';
        const ratingText = place.rating ? `${place.rating.toFixed(1)} ⭐ (${place.user_ratings_total || 0} reviews)` : 'No rating';

        const contentHtml = `
          ${photosHtml}
          <div class="space-y-4">
            <div>
              <h4 class="text-sm font-semibold text-coffee-700 mb-2">📍 Location</h4>
              <p class="text-sm text-coffee-600">${place.formatted_address || 'N/A'}</p>
            </div>
            
            <div class="grid grid-cols-2 gap-3">
              <div>
                <h4 class="text-sm font-semibold text-coffee-700 mb-2">⭐ Rating</h4>
                <p class="text-sm text-coffee-600">${ratingText}</p>
              </div>
              <div>
                <h4 class="text-sm font-semibold text-coffee-700 mb-2">💰 Price</h4>
                <p class="text-sm text-coffee-600">${priceText}</p>
              </div>
            </div>
            
            ${place.formatted_phone_number ? `<div>
              <h4 class="text-sm font-semibold text-coffee-700 mb-2">📱 Phone</h4>
              <p class="text-sm"><a href="tel:${place.formatted_phone_number}" class="text-brand-600 hover:underline">${place.formatted_phone_number}</a></p>
            </div>` : ''}
            
            ${hoursHtml}
            
            ${place.website ? `<div>
              <h4 class="text-sm font-semibold text-coffee-700 mb-2">🌐 Website</h4>
              <p class="text-sm"><a href="${place.website}" target="_blank" class="text-brand-600 hover:underline">Visit website</a></p>
            </div>` : ''}
            
            ${reviewsHtml}
            
            <div class="flex gap-2 pt-4">
              <a href="${place.url}" target="_blank" class="flex-1 px-4 py-2 bg-brand-500 text-white text-sm font-medium rounded-lg hover:bg-brand-600 transition text-center">Open in Google Maps</a>
            </div>
          </div>
        `;

        openModal(contentHtml, place.name);
      }
    );
  }

  // ---------------------------------------------------------------------
  // V2 ADDITION (additive only — nothing above this line was changed):
  // expose read-only references so src/enhance.js can layer the new AI
  // features on top of this exact code without editing any function above.
  // ---------------------------------------------------------------------
  window.CafeFinderInternal = { state, renderResults, addMarkers, showPlaceDetails, findNearbyCafes };
    