# Café Finder

A responsive JavaScript app using Google Maps JavaScript API + Places to find nearby cafés with filters, photos, distance, and directions. Works offline by showing last results from localStorage. Deploy easily to Vercel or Netlify.

## Setup

1. Enable APIs in Google Cloud Console:
   - Maps JavaScript API
   - Places API
2. Create an API key and restrict it to your domain.
3. In `index.html`, replace `YOUR_API_KEY` with your key.
4. Optional: add `geometry` library for distance: `&libraries=places,geometry`.

## Run locally

Open `index.html` in a browser. For geolocation and API loading, using an HTTP server is recommended:

- VS Code Live Server, or
- `python -m http.server` then open `http://localhost:8000`

## Deploy

- Vercel: New Project → Import your repo → Framework: “Other” (static) → Deploy
- Netlify: Drag-and-drop the folder, or link repo. Build command: none, Publish directory: root.

## Features

- Geolocation to center map to user
- Nearby cafés search with filters:
  - Budget (`price_level`)
  - Min rating
  - Open now
  - Prefer Wi‑Fi (heuristic using `internet_cafe` type)
- Result cards with photo, rating, price, distance
- Directions overlay and “Open in Google Maps”
- Offline: loads last successful results from localStorage
- Tailwind CSS for responsive design and polish


