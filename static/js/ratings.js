// AquaMusic Track Star Ratings widget (supports half-stars)
class RatingsManager {
  constructor() {
    this.ratings = {};
  }

  async init() {
    try {
      const saved = await window.api.getState('ratings');
      if (saved && typeof saved === 'object') {
        this.ratings = saved;
      } else {
        // One-time migration from the older WebEngine-only store.
        try { this.ratings = JSON.parse(localStorage.getItem('wavevault_ratings') || '{}'); } catch (_) { this.ratings = {}; }
        await window.api.saveState('ratings', this.ratings);
      }
    } catch (error) {
      console.warn('Could not load ratings from database.', error);
      try { this.ratings = JSON.parse(localStorage.getItem('wavevault_ratings') || '{}'); } catch (_) { this.ratings = {}; }
    }
  }

  getRating(trackId) {
    return this.ratings[trackId] || 0;
  }

  /**
   * Sets and saves a track's star rating.
   */
  setRating(trackId, rating, skipToast = false) {
    this.ratings[trackId] = rating;
    localStorage.setItem('wavevault_ratings', JSON.stringify(this.ratings));
    window.api.saveState('ratings', this.ratings).catch(error =>
      console.warn('Could not save ratings to database.', error)
    );
    
    // Notify lists and library details to refresh rating columns
    if (window.library) {
      window.library.updateTrackProperties(trackId, { rating: rating });
    }
    if (!skipToast) {
      window.toast.show(`Track rated ${rating} star${rating !== 1 ? 's' : ''}`, 'success');
    }
  }

  /**
   * Renders the 5-star rating widget inside a container.
   */
  render(container, trackId, canRate = true) {
    if (!container) return;
    container.innerHTML = '';
    container.style.display = 'flex';
    container.style.gap = '4px';
    container.style.alignItems = 'center';

    const currentRating = this.getRating(trackId);

    for (let i = 1; i <= 5; i++) {
      const starWrapper = document.createElement('div');
      starWrapper.className = 'star-wrapper';
      starWrapper.style.position = 'relative';
      starWrapper.style.display = 'inline-block';
      starWrapper.style.width = '24px';
      starWrapper.style.height = '24px';

      // Decide star fills
      let fillType = 0; // 0 = empty, 0.5 = half, 1 = full
      if (currentRating >= i) {
        fillType = 1;
      } else if (currentRating === i - 0.5) {
        fillType = 0.5;
      }

      // Generate visual SVG star
      const gradId = `star-grad-${trackId}-${i}`;
      let fillColor = 'none';
      if (fillType === 1) {
        fillColor = 'var(--warning)';
      } else if (fillType === 0.5) {
        fillColor = `url(#${gradId})`;
      }

      starWrapper.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" stroke="var(--warning)" stroke-width="1.8" fill="${fillColor}" style="pointer-events: none; transition: fill 0.2s;">
          ${fillType === 0.5 ? `
          <defs>
            <linearGradient id="${gradId}">
              <stop offset="50%" stop-color="var(--warning)" />
              <stop offset="50%" stop-color="transparent" />
            </linearGradient>
          </defs>
          ` : ''}
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      `;

      if (canRate) {
        // Overlay interactive left/right transparent halves
        const leftHalf = document.createElement('div');
        leftHalf.style.position = 'absolute';
        leftHalf.style.left = '0';
        leftHalf.style.top = '0';
        leftHalf.style.width = '50%';
        leftHalf.style.height = '100%';
        leftHalf.style.cursor = 'pointer';
        leftHalf.style.zIndex = '5';

        const rightHalf = document.createElement('div');
        rightHalf.style.position = 'absolute';
        rightHalf.style.left = '50%';
        rightHalf.style.top = '0';
        rightHalf.style.width = '50%';
        rightHalf.style.height = '100%';
        rightHalf.style.cursor = 'pointer';
        rightHalf.style.zIndex = '5';

        // Mouse click triggers
        leftHalf.addEventListener('click', (e) => {
          e.stopPropagation();
          this.setRating(trackId, i - 0.5);
          this.render(container, trackId, canRate);
        });

        rightHalf.addEventListener('click', (e) => {
          e.stopPropagation();
          this.setRating(trackId, i);
          this.render(container, trackId, canRate);
        });

        // Optional: Simple visual hovers can be added here
        starWrapper.appendChild(leftHalf);
        starWrapper.appendChild(rightHalf);
      }

      container.appendChild(starWrapper);
    }
  }
}

window.ratings = new RatingsManager();
