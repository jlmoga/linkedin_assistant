/**
 * Map Manager (Leaflet + OpenStreetMap)
 */

import * as dom from './dom.js';

let map = null;
let marker = null;
let circle = null;
let debounceTimer = null;

/**
 * Inicialitza el mapa.
 */
export function initMap() {
    if (map) return;

    try {
        // Inicialitzar mapa centrat en un punt neutre
        map = L.map('residence-map').setView([41.3851, 2.1734], 13); // Barcelona default

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);
        
        console.log("Mapa inicialitzat");
    } catch (e) {
        console.error("Error inicialitzant el mapa:", e);
    }
}

/**
 * Força a Leaflet a recalcular la mida del contenidor.
 * Necessari quan el mapa s'inicialitza en una pestanya oculta.
 */
export function invalidateMapSize() {
    if (map) {
        setTimeout(() => {
            map.invalidateSize();
            console.log("Mida del mapa invalidada i recalculada");
        }, 100);
    }
}

/**
 * Actualitza el mapa amb l'adreça i el radi proporcionats.
 * Utilitza debouncing per evitar crides excessives a Nominatim.
 */
export function updateMapDebounced(address, radiusKm) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        updateMap(address, radiusKm);
    }, 1000);
}

/**
 * Funció principal per geocodificar i dibuixar el radi.
 */
export async function updateMap(address, radiusKm) {
    if (!map) initMap();
    if (!address || address.length < 5) return;

    try {
        console.log(`Cercant adreça: ${address} amb radi ${radiusKm}km`);
        
        // Geocodificació amb Nominatim (OSM)
        // L'encapçalament User-Agent és obligatori per la política de Nominatim
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`, {
            headers: {
                'User-Agent': 'RumbLinkedInAssistant/1.0 (Professional Assistant App)'
            }
        });

        if (!response.ok) throw new Error("Error en la resposta de Nominatim");
        
        const data = await response.json();
        
        if (data && data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lon = parseFloat(data[0].lon);
            const pos = [lat, lon];

            // Netejar elements previs
            if (marker) map.removeLayer(marker);
            if (circle) map.removeLayer(circle);

            // Dibuixar marcador (Estil LinkedIn Blue)
            marker = L.marker(pos).addTo(map);
            
            // Dibuixar cercle de radi (Estil LinkedIn Blue suau)
            const radiusMeters = (radiusKm || 50) * 1000;
            circle = L.circle(pos, {
                radius: radiusMeters,
                color: '#0073b1', // LinkedIn Blue
                fillColor: '#0073b1',
                fillOpacity: 0.15,
                weight: 2
            }).addTo(map);

            // Ajustar el zoom automàticament per veure tot el radi
            map.fitBounds(circle.getBounds(), { padding: [20, 20] });
            
            console.log(`Mapa actualitzat a: ${data[0].display_name}`);
        } else {
            console.warn("No s'han trobat coordenades per aquesta adreça.");
        }
    } catch (e) {
        console.error("Error en actualitzar el mapa:", e);
    }
}

/**
 * Renderitza un mapa de ruta per a una oferta específica.
 */
export async function renderOfferRouteMap(containerId, residenceAddress, offerLocation, radiusKm) {
    if (!residenceAddress || !offerLocation || offerLocation === 'Desconeguda') return;

    try {
        console.log(`Generant mapa de ruta: ${residenceAddress} -> ${offerLocation}`);
        
        // Geocodificar ambdues ubicacions
        const [resCoords, offerCoords] = await Promise.all([
            geocodeAddress(residenceAddress),
            geocodeAddress(offerLocation)
        ]);

        if (!resCoords || !offerCoords) {
            console.warn("No s'ha pogut geocodificar una de les ubicacions.");
            return;
        }

        // Inicialitzar mapa estàtic (sense interacció)
        const offerMap = L.map(containerId, {
            dragging: false,
            zoomControl: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
            touchZoom: false,
            boxZoom: false,
            keyboard: false,
            attributionControl: false
        }).setView(resCoords, 12);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(offerMap);

        // Afegir Atribució mínima
        L.control.attribution({ prefix: false }).addAttribution('© OSM').addTo(offerMap);

        // Cercle de radi tènue
        const radiusMeters = (radiusKm || 50) * 1000;
        L.circle(resCoords, {
            radius: radiusMeters,
            color: '#0a66c2',
            fillColor: '#0a66c2',
            fillOpacity: 0.05, // Molt tènue
            weight: 1,
            dashArray: '5, 5'
        }).addTo(offerMap);

        // Marcador residència
        L.marker(resCoords, { 
            icon: L.divIcon({ 
                className: 'custom-div-icon', 
                html: "<div style='background-color:#0a66c2; width:10px; height:10px; border-radius:50%; border:2px solid white;'></div>",
                iconSize: [10, 10],
                iconAnchor: [5, 5]
            }) 
        }).addTo(offerMap);

        // Marcador oferta
        L.marker(offerCoords).addTo(offerMap);

        const routeData = await fetchRoute(resCoords, offerCoords);
        if (routeData && routeData.coords) {
            const routeLine = L.polyline(routeData.coords, {
                color: '#0a66c2',
                weight: 4,
                opacity: 0.8
            }).addTo(offerMap);

            // Ajustar vista
            const bounds = L.latLngBounds([resCoords, offerCoords]);
            offerMap.fitBounds(bounds, { padding: [30, 30] });

            return {
                distance: routeData.distance,
                duration: routeData.duration
            };
        } else {
            // Si no hi ha ruta, almenys veure els punts
            offerMap.fitBounds([resCoords, offerCoords], { padding: [50, 50] });
        }

    } catch (e) {
        console.error("Error renderitzant mapa d'oferta:", e);
    }
}

/**
 * Helper per geocodificar adreça
 */
async function geocodeAddress(address) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`, {
            headers: { 'User-Agent': 'RumbLinkedInAssistant/1.0' }
        });
        const data = await response.json();
        if (data && data.length > 0) {
            return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
        }
    } catch (e) {
        console.error("Error geocodificant:", address, e);
    }
    return null;
}

/**
 * Helper per obtenir ruta OSRM
 */
async function fetchRoute(start, end) {
    try {
        const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`);
        const data = await response.json();
        if (data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            return {
                // El format GeoJSON de OSRM és [lon, lat]
                coords: route.geometry.coordinates.map(coord => [coord[1], coord[0]]),
                distance: route.distance, // metres
                duration: route.duration  // segons
            };
        }
    } catch (e) {
        console.error("Error obtenint ruta OSRM:", e);
    }
    return null;
}
