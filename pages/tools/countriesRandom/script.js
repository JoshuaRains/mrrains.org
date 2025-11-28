document.addEventListener('DOMContentLoaded', async () => {
    // --- DOM Elements ---
    const mapContainer = document.getElementById('map-container');
    const pickBtn = document.getElementById('pick-btn');
    const resultDisplay = document.getElementById('result-display');
    const countDisplay = document.getElementById('count');
    const cardSpain = document.getElementById('card-spain');
    const cardGuinea = document.getElementById('card-guinea');

    // --- Data & State ---
    // Mapping from SVG ID to Country Name
    const countryMapping = {
        'path17': 'Mexico',
        'path12': 'Guatemala',
        'path4': 'Belize',
        'path24': 'El Salvador',
        'path14': 'Honduras',
        'path18': 'Nicaragua',
        'path7': 'Costa Rica',
        'path19': 'Panama',
        'path8': 'Cuba',
        'path15': 'Haiti',
        'path9': 'Dominican Republic',
        'path21': 'Puerto Rico',
        'path6': 'Colombia',
        'path26': 'Venezuela',
        'path29': 'Brazil',
        'path22': 'Paraguay',
        'path25': 'Uruguay',
        'path27': 'Argentina',
        'path5': 'Chile',
        'path20': 'Peru',
        'path28': 'Bolivia',
        'path10': 'Ecuador'
    };

    // List of IDs that are actually Spanish speaking for the game
    const spanishSpeakingIds = [
        'path17', 'path12', 'path24', 'path14', 'path18', 'path7', 'path19',
        'path8', 'path9', 'path21', 'path6', 'path26',
        'path22', 'path25', 'path27', 'path5', 'path20', 'path28', 'path10'
    ];

    // Extra countries not on map (or treated separately)
    const extraCountries = [
        { id: 'card-spain', name: 'Spain' },
        { id: 'card-guinea', name: 'Equatorial Guinea' }
    ];

    let availableCountries = [...spanishSpeakingIds, ...extraCountries.map(c => c.id)];
    let isAnimating = false;

    // --- Initialization ---
    async function init() {
        // Load SVG
        try {
            const response = await fetch('map.svg');
            const svgText = await response.text();
            mapContainer.innerHTML = svgText;

            // Setup SVG
            const svg = mapContainer.querySelector('svg');
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');

            // Initialize paths
            const paths = svg.querySelectorAll('path');
            paths.forEach(path => {
                if (countryMapping[path.id]) {
                    // It's a known country
                    if (spanishSpeakingIds.includes(path.id)) {
                        // It's a target country
                        path.classList.add('target-country');
                    } else {
                        // It's a neighbor (Brazil, Guyana, etc)
                        path.classList.add('dimmed');
                    }
                } else {
                    // Unknown path, dim it
                    path.classList.add('dimmed');
                }
            });

            updateCount();

        } catch (e) {
            console.error("Error loading map:", e);
            resultDisplay.innerHTML = '<span style="color:red">Error loading map</span>';
        }
    }

    // --- Logic ---

    function updateCount() {
        countDisplay.textContent = availableCountries.length;
        if (availableCountries.length === 0) {
            pickBtn.disabled = true;
            pickBtn.querySelector('.btn-text').textContent = 'Game Over';
        }
    }

    function highlightCountry(id, state) {
        // Check if it's a card or a map path
        if (id.startsWith('card-')) {
            const card = document.getElementById(id);
            if (card) {
                if (state === 'on') card.classList.add('highlight');
                else card.classList.remove('highlight');

                if (state === 'selected') card.classList.add('selected');
            }
        } else {
            // Map path
            const path = document.getElementById(id);
            if (path) {
                if (state === 'on') path.classList.add('highlight');
                else path.classList.remove('highlight');

                if (state === 'selected') path.classList.add('selected');
            }
        }
    }

    function getCountryName(id) {
        if (id.startsWith('card-')) {
            const c = extraCountries.find(x => x.id === id);
            return c ? c.name : id;
        }
        return countryMapping[id] || id;
    }

    async function pickRandom() {
        if (isAnimating || availableCountries.length === 0) return;
        isAnimating = true;
        pickBtn.disabled = true;
        resultDisplay.innerHTML = '<span class="placeholder-text">Picking...</span>';

        // Pick the winner immediately
        const winnerIdx = Math.floor(Math.random() * availableCountries.length);
        const winnerId = availableCountries[winnerIdx];

        // Animation parameters
        let speed = 50;
        const maxSpeed = 400;
        const minSteps = 50; // Increased for longer animation
        let currentStep = 0;
        let lastHighlighted = null;
        let currentIdx = 0; // Start from the beginning of the list

        const animate = () => {
            // Clear last
            if (lastHighlighted) {
                highlightCountry(lastHighlighted, 'off');
            }

            // Get next country in sequence
            const currentId = availableCountries[currentIdx];

            highlightCountry(currentId, 'on');
            lastHighlighted = currentId;

            currentStep++;

            // Check if we should stop
            // We stop if we've done enough steps AND we are currently on the winner
            if (currentStep > minSteps && currentId === winnerId) {
                finishSelection(winnerId);
            } else {
                // Continue animating
                // Move to next index
                currentIdx = (currentIdx + 1) % availableCountries.length;

                // Slow down as we go
                if (currentStep > minSteps * 0.7) {
                    speed *= 1.1;
                }
                setTimeout(animate, speed);
            }
        };

        animate();
    }

    function finishSelection(finalId) {
        // Ensure the final one is highlighted
        highlightCountry(finalId, 'on'); // Keep highlight or switch to selected?

        // Remove from available
        availableCountries = availableCountries.filter(id => id !== finalId);

        // Visuals
        setTimeout(() => {
            highlightCountry(finalId, 'off');
            highlightCountry(finalId, 'selected');

            const name = getCountryName(finalId);
            resultDisplay.innerHTML = `<span>${name}</span>`;

            // Confetti or sound could go here

            isAnimating = false;
            updateCount();
            if (availableCountries.length > 0) {
                pickBtn.disabled = false;
            }
        }, 300);
    }

    // --- Event Listeners ---
    pickBtn.addEventListener('click', pickRandom);

    // Start
    init();
});
