function updateStatusIndicator(status) {
    const statusIndicator = document.getElementById('status-indicator');
    if (!statusIndicator) {
        return;
    }

    // Remove existing status classes
    statusIndicator.className = 'status-indicator';

    // Add appropriate status class and icon
    if (status === 'playing') {
        statusIndicator.classList.add('status-playing');
        statusIndicator.textContent = '▶';
    } else if (status === 'paused') {
        statusIndicator.classList.add('status-paused');
        statusIndicator.textContent = '⏸';
    } else {
        statusIndicator.classList.add('status-stopped');
        statusIndicator.textContent = '⏹';
    }
}

function updatePlayPauseButton(status) {
    const playPauseBtn = document.getElementById('play-pause-btn');
    if (!playPauseBtn) {
        return;
    }

    if (status === 'playing' || status === 'Playing') {
        playPauseBtn.innerHTML = '⏸️';
        playPauseBtn.title = 'Pause';
    } else {
        playPauseBtn.innerHTML = '▶️';
        playPauseBtn.title = 'Play';
    }
}

function showNoMusic() {
    // console.log("Showing no music UI");

    // Clear any running intervals
    // if (progressUpdateInterval) {
    //     clearInterval(progressUpdateInterval);
    //     progressUpdateInterval = null;
    // }

    const musicInfoEl = document.getElementById('music-info');
    const noMusicEl = document.getElementById('no-music');

    if (musicInfoEl) {
        musicInfoEl.classList.add('hidden');
    }
    if (noMusicEl) {
        noMusicEl.classList.remove('hidden');
    }

    currentTrack = null;
}

function updateArtwork(artworkUri) {
    const albumArt = document.getElementById('album-art');
    const musicContainer = document.querySelector('.music-container'); // Use class instead of ID

    if (!albumArt) {
        return;
    }

    if (artworkUri && artworkUri !== '') {
        // Update the album art container
        albumArt.innerHTML = `<img src="${artworkUri}" alt="Album artwork" onerror="this.parentElement.innerHTML='🎵'">`;

        // Add blurred background to the main container
        if (musicContainer) {
            musicContainer.style.position = 'relative';

            // Create or update background overlay
            let backgroundOverlay = musicContainer.querySelector('.background-overlay');
            if (!backgroundOverlay) {
                backgroundOverlay = document.createElement('div');
                backgroundOverlay.className = 'background-overlay';
                musicContainer.insertBefore(backgroundOverlay, musicContainer.firstChild);
            }

            backgroundOverlay.style.position = 'absolute';
            backgroundOverlay.style.top = '0';
            backgroundOverlay.style.left = '0';
            backgroundOverlay.style.width = '100%';
            backgroundOverlay.style.height = '100%';
            backgroundOverlay.style.backgroundImage = `url('${artworkUri}')`;
            backgroundOverlay.style.backgroundSize = 'cover';
            backgroundOverlay.style.backgroundPosition = 'center';
            backgroundOverlay.style.filter = 'blur(20px) brightness(0.3)';
            backgroundOverlay.style.opacity = '0.6';
            backgroundOverlay.style.zIndex = '-1';
            backgroundOverlay.style.borderRadius = '10px';
        }
    } else {
        // No artwork - reset to default
        albumArt.innerHTML = '🎵';

        if (musicContainer) {
            const backgroundOverlay = musicContainer.querySelector('.background-overlay');
            if (backgroundOverlay) {
                backgroundOverlay.remove();
            }
        }
    }
}

// Add loading state functions
function showLoadingState() {
    const container = document.querySelector('.music-container');
    container?.classList.add('loading');

    // Add skeleton animation
    const trackTitle = document.getElementById('track-title');
    const trackArtist = document.getElementById('track-artist');

    if (trackTitle) { trackTitle.innerHTML = '<div class="skeleton-text"></div>'; }
    if (trackArtist) { trackArtist.innerHTML = '<div class="skeleton-text short"></div>'; }
}

function hideLoadingState() {
    const container = document.querySelector('.music-container');
    container?.classList.remove('loading');
}

export {
    updateStatusIndicator,
    updatePlayPauseButton,
    showNoMusic,
    updateArtwork,
    showLoadingState,
    hideLoadingState,
};