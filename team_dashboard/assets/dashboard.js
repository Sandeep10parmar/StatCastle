// Development mode flag - set to false in production
const DEV_MODE = false; // Change to true for debugging

// Conditional logging - only log in dev mode
function devLog(...args) {
  if (DEV_MODE) {
    console.log(...args);
  }
}

function devWarn(...args) {
  if (DEV_MODE) {
    console.warn(...args);
  }
}

// Always log errors
function logError(...args) {
  console.error(...args);
}

let allData = {};
let filteredData = {};
let rosterMap = {}; // Map of player name -> photo URL
let rosterNames = new Set(); // Set of player names for filtering
let isLoading = false;
let loadingOverlay = null;
let retryCount = 0;
const MAX_RETRIES = 3;
let seriesNameMapping = {}; // Map of normalized series name -> array of original series names

// Mobile detection helper
function isMobile() {
  return window.innerWidth <= 768;
}

// Debounce function for filter application
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Sync mobile and desktop filter inputs
function syncMobileDesktopFilters(direction = 'both') {
  // Sync desktop -> mobile
  if (direction === 'desktop-to-mobile' || direction === 'both') {
    const desktopStartDate = document.getElementById('startDate');
    const desktopEndDate = document.getElementById('endDate');
    const desktopSeries = document.getElementById('seriesSelect');
    const desktopAutoApply = document.getElementById('autoApplyToggle');
    
    const mobileStartDate = document.getElementById('startDateMobile');
    const mobileEndDate = document.getElementById('endDateMobile');
    const mobileSeries = document.getElementById('seriesSelectMobile');
    const mobileAutoApply = document.getElementById('autoApplyToggleMobile');
    
    if (desktopStartDate && mobileStartDate) mobileStartDate.value = desktopStartDate.value;
    if (desktopEndDate && mobileEndDate) mobileEndDate.value = desktopEndDate.value;
    if (desktopSeries && mobileSeries) {
      Array.from(mobileSeries.options).forEach(opt => {
        opt.selected = Array.from(desktopSeries.options).some(dOpt => 
          dOpt.value === opt.value && dOpt.selected
        );
      });
    }
    if (desktopAutoApply && mobileAutoApply) {
      mobileAutoApply.checked = desktopAutoApply.checked;
    }
  }
  
  // Sync mobile -> desktop
  if (direction === 'mobile-to-desktop' || direction === 'both') {
    const mobileStartDate = document.getElementById('startDateMobile');
    const mobileEndDate = document.getElementById('endDateMobile');
    const mobileSeries = document.getElementById('seriesSelectMobile');
    const mobileAutoApply = document.getElementById('autoApplyToggleMobile');
    
    const desktopStartDate = document.getElementById('startDate');
    const desktopEndDate = document.getElementById('endDate');
    const desktopSeries = document.getElementById('seriesSelect');
    const desktopAutoApply = document.getElementById('autoApplyToggle');
    
    if (mobileStartDate && desktopStartDate) desktopStartDate.value = mobileStartDate.value;
    if (mobileEndDate && desktopEndDate) desktopEndDate.value = mobileEndDate.value;
    if (mobileSeries && desktopSeries) {
      Array.from(desktopSeries.options).forEach(opt => {
        opt.selected = Array.from(mobileSeries.options).some(mOpt => 
          mOpt.value === opt.value && mOpt.selected
        );
      });
    }
    if (mobileAutoApply && desktopAutoApply) {
      desktopAutoApply.checked = mobileAutoApply.checked;
    }
  }
}

// Open filter modal
function openFilterModal() {
  const modal = document.getElementById('filterModal');
  const iconBtn = document.getElementById('filterIconBtn');
  
  if (!modal || !iconBtn) return;
  
  // Sync desktop to mobile before opening
  syncMobileDesktopFilters('desktop-to-mobile');
  
  modal.setAttribute('aria-hidden', 'false');
  iconBtn.setAttribute('aria-expanded', 'true');
  document.body.classList.add('modal-open');
  
  // Focus on close button for accessibility
  const closeBtn = document.getElementById('closeFilterModal');
  if (closeBtn) {
    setTimeout(() => closeBtn.focus(), 100);
  }
}

// Close filter modal
function closeFilterModal() {
  const modal = document.getElementById('filterModal');
  const iconBtn = document.getElementById('filterIconBtn');
  
  if (!modal || !iconBtn) return;
  
  // Sync mobile to desktop before closing
  syncMobileDesktopFilters('mobile-to-desktop');
  
  modal.setAttribute('aria-hidden', 'true');
  iconBtn.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('modal-open');
  
  // Return focus to filter icon button
  if (iconBtn) {
    iconBtn.focus();
  }
}

// Show loading overlay
function showLoading(message = 'Loading data...') {
  if (loadingOverlay) {
    loadingOverlay.remove();
  }
  
  loadingOverlay = document.createElement('div');
  loadingOverlay.className = 'loading-overlay';
  loadingOverlay.setAttribute('role', 'status');
  loadingOverlay.setAttribute('aria-live', 'polite');
  loadingOverlay.innerHTML = `
    <div class="loading-spinner" aria-hidden="true"></div>
    <div class="loading-text">${message}</div>
  `;
  document.body.appendChild(loadingOverlay);
  isLoading = true;
}

// Hide loading overlay
function hideLoading() {
  if (loadingOverlay) {
    loadingOverlay.remove();
    loadingOverlay = null;
  }
  isLoading = false;
}

// Enhanced error handling with retry
function showError(message, retryCallback = null) {
  let errorBanner = document.getElementById('errorBanner');
  if (!errorBanner) {
    errorBanner = document.createElement('div');
    errorBanner.id = 'errorBanner';
    errorBanner.className = 'error-banner';
    errorBanner.setAttribute('role', 'alert');
    errorBanner.setAttribute('aria-live', 'assertive');
    
    if (document.body) {
      document.body.insertBefore(errorBanner, document.body.firstChild);
    } else {
      setTimeout(() => {
        if (document.body) {
          document.body.insertBefore(errorBanner, document.body.firstChild);
        }
      }, 100);
    }
  }
  
  let errorContent = `<strong><span aria-hidden="true">⚠️</span> <span class="sr-only">Error:</span> ${message}</strong>`;
  
  if (retryCallback && retryCount < MAX_RETRIES) {
    const retryBtn = document.createElement('button');
    retryBtn.className = 'retry-btn';
    retryBtn.textContent = 'Retry';
    retryBtn.setAttribute('aria-label', 'Retry loading data');
    retryBtn.onclick = () => {
      retryCount++;
      errorBanner.remove();
      retryCallback();
    };
    errorContent += retryBtn.outerHTML;
  }
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close-btn';
  closeBtn.innerHTML = '×';
  closeBtn.setAttribute('aria-label', 'Close error message');
  closeBtn.onclick = () => {
    errorBanner.remove();
  };
  errorContent += closeBtn.outerHTML;
  
  errorBanner.innerHTML = errorContent;
}

// Helper function to normalize player name for matching
function normalizePlayerName(name) {
  if (!name) return '';
  return name.trim();
}

// Helper function to normalize series names (matches Python logic)
function normalizeSeriesName(seriesName) {
  if (!seriesName) return seriesName;
  
  // Pattern 1: HPT20L_SERIES_XX -> HPTL(SXX)
  const hpt20lMatch = seriesName.match(/HPT20L_SERIES_(\d+)/i);
  if (hpt20lMatch) {
    const seasonNum = hpt20lMatch[1];
    return `HPTL(S${seasonNum})`;
  }
  
  // Pattern 2: Season X - Division Name (CODE) -> HUPL(CODE)
  const parenMatch = seriesName.match(/\(([A-Z0-9]+)\)/);
  if (parenMatch) {
    const code = parenMatch[1];
    // Check if it's a HUPL format (Season X - ...)
    if (/Season\s+\d+/i.test(seriesName)) {
      return `HUPL(${code})`;
    }
  }
  
  // If no pattern matched, return original
  return seriesName;
}

// Helper function to format date as human-readable (e.g., "1st Nov 2025")
function formatHumanDate(dateString) {
  if (!dateString || dateString === '-') return dateString || '-';
  
  try {
    const date = new Date(dateString + 'T00:00:00'); // Add time to avoid timezone issues
    if (isNaN(date.getTime())) return dateString; // Invalid date, return original
    
    const day = date.getDate();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[date.getMonth()];
    const year = date.getFullYear();
    
    // Add ordinal suffix to day
    let daySuffix = 'th';
    if (day === 1 || day === 21 || day === 31) daySuffix = 'st';
    else if (day === 2 || day === 22) daySuffix = 'nd';
    else if (day === 3 || day === 23) daySuffix = 'rd';
    
    return `${day}${daySuffix} ${month} ${year}`;
  } catch (e) {
    return dateString; // Return original if parsing fails
  }
}

// Helper function to format match type with labels
function formatMatchType(matchType) {
  if (!matchType || matchType === '-') return '-';
  
  const type = matchType.trim();
  const typeLower = type.toLowerCase();
  
  // Map common abbreviations and types to formatted labels
  const matchTypeMap = {
    'qf': 'QF (Quarter Final)',
    'quarter final': 'QF (Quarter Final)',
    'quarterfinal': 'QF (Quarter Final)',
    'sf': 'SF (Semi Final)',
    'semi final': 'SF (Semi Final)',
    'semifinal': 'SF (Semi Final)',
    'final': 'Final',
    'group stage': 'Group Stage (League)',
    'league': 'Group Stage (League)',
    'group': 'Group Stage (League)',
  };
  
  // Check for exact matches (case-insensitive)
  for (const [key, label] of Object.entries(matchTypeMap)) {
    if (typeLower === key || typeLower.includes(key)) {
      return label;
    }
  }
  
  // If it contains "quarter" or "qf", format as Quarter Final
  if (typeLower.includes('quarter') || typeLower.includes('qf')) {
    return 'QF (Quarter Final)';
  }
  
  // If it contains "semi" or "sf", format as Semi Final
  if (typeLower.includes('semi') || typeLower.includes('sf')) {
    return 'SF (Semi Final)';
  }
  
  // If it contains "final" (but not quarter/semi), format as Final
  if (typeLower.includes('final') && !typeLower.includes('quarter') && !typeLower.includes('semi')) {
    return 'Final';
  }
  
  // If it contains "group" or "league", format as Group Stage
  if (typeLower.includes('group') || typeLower.includes('league')) {
    return 'Group Stage (League)';
  }
  
  // Return original if no match found
  return type;
}

// Helper function to load team logo dynamically
async function loadTeamLogo(teamAnalytics, teamName) {
  const logoEl = document.getElementById('teamLogo');
  if (!logoEl) return;
  
  let logoPath = null;
  
  // First, check if logo_path is specified in team_analytics.json
  if (teamAnalytics && typeof teamAnalytics === 'object' && !Array.isArray(teamAnalytics)) {
    if ('logo_path' in teamAnalytics && teamAnalytics.logo_path) {
      logoPath = teamAnalytics.logo_path;
    }
  }
  
  // If no logo_path, try pattern: assets/{team_name}_Logo.png
  if (!logoPath && teamName && teamName !== 'Team') {
    logoPath = `assets/${teamName}_Logo.png`;
  }
  
  // Try to load the logo
  if (logoPath) {
    try {
      const img = new Image();
      img.onload = function() {
        logoEl.src = logoPath;
        logoEl.classList.add('visible');
        logoEl.setAttribute('alt', `${teamName} logo`);
        devLog(`Loaded team logo: ${logoPath}`);
      };
      img.onerror = function() {
        devLog(`Logo not found at ${logoPath}`);
        // Logo element stays hidden (display: none by default)
      };
      img.src = logoPath;
    } catch (e) {
      devWarn('Error loading logo:', e);
    }
  }
}

// Helper function to check if a player is in the roster
function isRoyalsPlayer(playerName) {
  if (!playerName) return false;
  const normalized = normalizePlayerName(playerName);
  // Check exact match first
  if (rosterNames.has(normalized)) {
    return true;
  }
  // Check case-insensitive match
  const normalizedLower = normalized.toLowerCase();
  for (const rosterName of rosterNames) {
    if (rosterName.toLowerCase() === normalizedLower) {
      return true;
    }
  }
  // Also try matching with allData.stats as fallback (in case CSV didn't load)
  if (rosterNames.size === 0 && allData.stats && allData.stats[normalized]) {
    return true;
  }
  return false;
}

// Check for file:// protocol immediately (before DOM ready)
if (window.location.protocol === 'file:') {
  setTimeout(() => {
    showError('This dashboard must be served via HTTP. Please run: <code>python3 -m http.server 8000</code> in the team_dashboard directory, then open <code>http://localhost:8000</code>');
  }, 100);
}

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', function() {
  // Navigation with keyboard support
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.setAttribute('role', 'tab');
    btn.setAttribute('tabindex', '0');
    
    btn.addEventListener('click', function() {
      navigateToPage(this.getAttribute('data-page'));
    });
    
    // Keyboard support
    btn.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        navigateToPage(this.getAttribute('data-page'));
      }
    });
  });

  // Apply Filters button with keyboard support
  const applyBtn = document.getElementById('applyFiltersBtn');
  if (applyBtn) {
    applyBtn.setAttribute('aria-label', 'Apply filters to dashboard data');
    applyBtn.addEventListener('click', function() {
      applyFilters();
    });
    
    // Enter key support
    applyBtn.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyFilters();
      }
    });
  }

  // Keyboard support for filters
  const startDateInput = document.getElementById('startDate');
  const endDateInput = document.getElementById('endDate');
  const seriesSelect = document.getElementById('seriesSelect');
  
  if (startDateInput) {
    startDateInput.setAttribute('aria-label', 'Start date filter');
    startDateInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyFilters();
      }
    });
  }
  
  if (endDateInput) {
    endDateInput.setAttribute('aria-label', 'End date filter');
    endDateInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyFilters();
      }
    });
  }
  
  if (seriesSelect) {
    seriesSelect.setAttribute('aria-label', 'Series filter');
    seriesSelect.setAttribute('aria-multiselectable', 'true');
  }

  // Auto-apply toggle
  const autoApplyToggle = document.getElementById('autoApplyToggle');
  if (autoApplyToggle) {
    // Load saved preference
    const savedAutoApply = localStorage.getItem('autoApplyFilters');
    if (savedAutoApply === 'true') {
      autoApplyToggle.checked = true;
    }
    
    autoApplyToggle.addEventListener('change', function() {
      localStorage.setItem('autoApplyFilters', this.checked ? 'true' : 'false');
    });
  }

  // Filter presets
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const preset = this.getAttribute('data-preset');
      applyFilterPreset(preset);
    });
  });

  // Clear filters button
  const clearBtn = document.getElementById('clearFiltersBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', function() {
      clearFilters();
    });
  }

  // Mobile filter modal handlers
  const modal = document.getElementById('filterModal');
  
  // Mobile filter icon button
  const filterIconBtn = document.getElementById('filterIconBtn');
  if (filterIconBtn && modal) {
    filterIconBtn.addEventListener('click', function() {
      if (modal.getAttribute('aria-hidden') === 'true') {
        openFilterModal();
      } else {
        closeFilterModal();
      }
    });
  }
  const closeModalBtn = document.getElementById('closeFilterModal');
  const backdrop = modal ? modal.querySelector('.filter-modal-backdrop') : null;

  if (modal) {
    // Close on backdrop click
    if (backdrop) {
      backdrop.addEventListener('click', closeFilterModal);
    }

    // Close on escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') {
        closeFilterModal();
      }
    });
  }

  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', closeFilterModal);
  }

  // Mobile filter buttons
  const applyBtnMobile = document.getElementById('applyFiltersBtnMobile');
  if (applyBtnMobile) {
    applyBtnMobile.addEventListener('click', function() {
      syncMobileDesktopFilters('mobile-to-desktop');
      applyFilters();
      closeFilterModal();
    });
  }

  const clearBtnMobile = document.getElementById('clearFiltersBtnMobile');
  if (clearBtnMobile) {
    clearBtnMobile.addEventListener('click', function() {
      clearFilters();
      syncMobileDesktopFilters('desktop-to-mobile');
    });
  }

  // Mobile auto-apply toggle
  const autoApplyToggleMobile = document.getElementById('autoApplyToggleMobile');
  if (autoApplyToggleMobile) {
    const desktopAutoApply = document.getElementById('autoApplyToggle');
    if (desktopAutoApply) {
      autoApplyToggleMobile.checked = desktopAutoApply.checked;
    }
    
    autoApplyToggleMobile.addEventListener('change', function() {
      syncMobileDesktopFilters('mobile-to-desktop');
      const desktopAutoApply = document.getElementById('autoApplyToggle');
      if (desktopAutoApply) {
        desktopAutoApply.checked = this.checked;
        localStorage.setItem('autoApplyFilters', this.checked ? 'true' : 'false');
      }
    });
  }

  // Mobile filter inputs - sync on change
  const startDateMobile = document.getElementById('startDateMobile');
  const endDateMobile = document.getElementById('endDateMobile');
  const seriesSelectMobile = document.getElementById('seriesSelectMobile');

  if (startDateMobile) {
    startDateMobile.addEventListener('change', function() {
      syncMobileDesktopFilters('mobile-to-desktop');
      updateActiveFilters();
      if (isAutoApplyEnabled()) {
        applyFilters();
      }
    });
  }

  if (endDateMobile) {
    endDateMobile.addEventListener('change', function() {
      syncMobileDesktopFilters('mobile-to-desktop');
      updateActiveFilters();
      if (isAutoApplyEnabled()) {
        applyFilters();
      }
    });
  }

  if (seriesSelectMobile) {
    seriesSelectMobile.addEventListener('change', function() {
      syncMobileDesktopFilters('mobile-to-desktop');
      updateActiveFilters();
      if (isAutoApplyEnabled()) {
        applyFilters();
      }
    });
  }

  // Set up auto-apply listeners if enabled
  setupAutoApplyListeners();

  // Load data
  loadData();
});

// Navigation function
function navigateToPage(pageId) {
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  
  const activeBtn = document.querySelector(`[data-page="${pageId}"]`);
  const activePage = document.getElementById(pageId);
  
  if (activeBtn) {
    activeBtn.classList.add('active');
    activeBtn.setAttribute('aria-selected', 'true');
  }
  if (activePage) {
    activePage.classList.add('active');
  }
}

async function loadData() {
  try {
    showLoading('Loading dashboard data...');
    retryCount = 0;
    
    // Helper function to fetch with better error handling and timeout
    async function fetchJSON(url, name) {
      try {
        // Add timeout to prevent hanging
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        devLog(`Loaded ${name}:`, Array.isArray(data) ? `${data.length} items` : `${Object.keys(data).length} keys`);
        return data;
      } catch (e) {
        if (e.name === 'AbortError') {
          const errorMsg = `Timeout loading ${name}. This usually means you're opening the file directly. Please use a local server: <code>python3 -m http.server 8000</code> in the team_dashboard directory.`;
          logError(`Timeout loading ${name} from ${url} - likely CORS issue`);
          throw new Error(errorMsg);
        } else {
          logError(`Error loading ${name} from ${url}:`, e);
          throw new Error(`Failed to load ${name}. ${e.message}`);
        }
      }
    }
    
    // Helper function to parse CSV and load roster
    async function loadRoster() {
      try {
        // Load players.csv from assets directory (copied there by analyze.py)
        const response = await fetch('assets/players.csv');
        if (!response.ok) {
          devWarn('Could not load players.csv, continuing without roster filter');
          return;
        }
        
        const csvText = await response.text();
        const lines = csvText.split('\n');
        
        // Skip first two lines (empty header and "Name,PhotoURL" header)
        for (let i = 2; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          // Parse CSV line - split by comma (CSV format: ,Name,PhotoURL)
          const parts = line.split(',').map(p => p.trim());
          
          // CSV format has leading comma, so:
          // parts[0] = "" (empty from leading comma)
          // parts[1] = "Name"
          // parts[2] = "PhotoURL"
          if (parts.length < 3) continue;
          
          const name = parts[1]; // Name is in second column (index 1)
          const photoUrl = parts[2] || '';
          
          if (!name || name.toLowerCase() === 'name' || name === '') continue;
          
          // Normalize name for matching
          const normalizedName = name.trim();
          rosterNames.add(normalizedName);
          if (photoUrl) {
            rosterMap[normalizedName] = photoUrl;
          }
        }
        devLog(`Loaded roster: ${rosterNames.size} players`);
      } catch (e) {
        devWarn('Error loading players.csv:', e);
      }
    }
    
    // Load roster first
    await loadRoster();
    
    showLoading('Loading player statistics...');
    const [stats, photos, matchResults, teamAnalytics, seriesList] = await Promise.all([
      fetchJSON('assets/player_stats.json?v=' + Date.now(), 'player_stats'), // Cache busting
      fetchJSON('assets/player_photos.json?v=' + Date.now(), 'player_photos'),
      fetchJSON('assets/match_results.json?v=' + Date.now(), 'match_results'),
      fetchJSON('assets/team_analytics.json?v=' + Date.now(), 'team_analytics'), // Cache busting
      fetchJSON('assets/series_list.json?v=' + Date.now(), 'series_list') // Cache busting
    ]);
    
    devLog('Data loaded:', {
      statsCount: Object.keys(stats || {}).length,
      matchResultsCount: (matchResults || []).length,
      seriesCount: (seriesList || []).length
    });
    
    allData = { 
      stats: stats || {}, 
      photos: photos || {}, 
      matchResults: matchResults || [], 
      teamAnalytics: teamAnalytics || {}, 
      seriesList: seriesList || [] 
    };
    
    // Create mapping between normalized and original series names
    // seriesList contains normalized names, matchResults contains original names
    seriesNameMapping = {};
    const originalSeriesNames = [...new Set((matchResults || []).map(m => m.series).filter(s => s))];
    
    // Build mapping: normalized -> array of original names
    originalSeriesNames.forEach(originalName => {
      const normalizedName = normalizeSeriesName(originalName);
      if (!seriesNameMapping[normalizedName]) {
        seriesNameMapping[normalizedName] = [];
      }
      if (!seriesNameMapping[normalizedName].includes(originalName)) {
        seriesNameMapping[normalizedName].push(originalName);
      }
    });
    
    // Also add any normalized names from seriesList that might not be in matchResults yet
    if (seriesList && seriesList.length > 0) {
      seriesList.forEach(normalizedName => {
        if (!seriesNameMapping[normalizedName]) {
          // Try to find original names that normalize to this
          const matchingOriginals = originalSeriesNames.filter(orig => 
            normalizeSeriesName(orig) === normalizedName
          );
          if (matchingOriginals.length > 0) {
            seriesNameMapping[normalizedName] = matchingOriginals;
          } else {
            // If no match found, use normalized name as both key and value
            seriesNameMapping[normalizedName] = [normalizedName];
          }
        }
      });
    }
    
    // Initialize filteredData with all data
    filteredData = {
      stats: stats || {},
      matchResults: matchResults || [],
      teamAnalytics: teamAnalytics || {},
      validMatchKeys: null // Will be set when filters are applied
    };
    
    // Update dashboard title with team name
    let teamName = 'Team'; // default fallback
    if (teamAnalytics && typeof teamAnalytics === 'object' && !Array.isArray(teamAnalytics)) {
      if ('team_name' in teamAnalytics && teamAnalytics.team_name) {
        teamName = teamAnalytics.team_name;
      }
    }
    const titleText = `${teamName} — StatCastle`;
    
    // Update title elements
    const dashboardTitleEl = document.getElementById('dashboardTitle');
    const pageTitleEl = document.getElementById('pageTitle');
    if (dashboardTitleEl) {
      dashboardTitleEl.textContent = titleText;
    }
    if (pageTitleEl) {
      pageTitleEl.textContent = titleText;
    }
    
    // Load team logo dynamically
    loadTeamLogo(teamAnalytics, teamName);
    
    // Populate series dropdown (desktop and mobile) with normalized names
    const seriesSelect = document.getElementById('seriesSelect');
    const seriesSelectMobile = document.getElementById('seriesSelectMobile');
    const seriesSelects = [seriesSelect, seriesSelectMobile].filter(s => s !== null);
    
    if (seriesSelects.length > 0) {
      // Use normalized names from seriesList, or normalize original names from matchResults
      const normalizedSeriesList = seriesList && seriesList.length > 0 ? seriesList : 
        [...new Set(originalSeriesNames.map(s => normalizeSeriesName(s)))].sort();
      
      seriesSelects.forEach(select => {
        select.innerHTML = ''; // Clear first
        if (normalizedSeriesList.length > 0) {
          normalizedSeriesList.forEach(normalizedName => {
            const opt = document.createElement('option');
            opt.value = normalizedName; // Store normalized name as value
            opt.textContent = normalizedName; // Display normalized name
            opt.selected = true;
            select.appendChild(opt);
          });
        }
      });
    }
    
    hideLoading();
    applyFilters();
    
    // Convert tables to cards on mobile after initial load
    setTimeout(convertAllTablesToCards, 100);
  } catch (e) {
    hideLoading();
    logError('Error loading data:', e);
    showError(`Error loading dashboard data: ${e.message}. Check browser console for details.`, loadData);
  }
}

// Debounced filter application
const debouncedApplyFilters = debounce(applyFilters, 300);

// Check if auto-apply is enabled
function isAutoApplyEnabled() {
  // Check desktop toggle (always in sync with mobile)
  const toggle = document.getElementById('autoApplyToggle');
  return toggle && toggle.checked;
}

// Setup auto-apply event listeners
function setupAutoApplyListeners() {
  const startDateInput = document.getElementById('startDate');
  const endDateInput = document.getElementById('endDate');
  const seriesSelect = document.getElementById('seriesSelect');
  
  // Add change listeners that check auto-apply setting
  if (startDateInput) {
    startDateInput.addEventListener('change', function() {
      updateActiveFilters();
      if (isAutoApplyEnabled()) {
        debouncedApplyFilters();
      }
    });
  }
  
  if (endDateInput) {
    endDateInput.addEventListener('change', function() {
      updateActiveFilters();
      if (isAutoApplyEnabled()) {
        debouncedApplyFilters();
      }
    });
  }
  
  if (seriesSelect) {
    seriesSelect.addEventListener('change', function() {
      updateActiveFilters();
      if (isAutoApplyEnabled()) {
        debouncedApplyFilters();
      }
    });
  }
}

// Apply filter preset
function applyFilterPreset(preset) {
  const startDateInput = document.getElementById('startDate');
  const endDateInput = document.getElementById('endDate');
  const seriesSelect = document.getElementById('seriesSelect');
  const results = allData.matchResults || [];
  
  if (!startDateInput || !endDateInput || !seriesSelect) return;
  
  let startDate = '';
  let endDate = '';
  
  if (preset === 'alltime') {
    startDate = '';
    endDate = '';
  } else if (preset === 'last5') {
    // Get last 5 matches
    const sortedResults = [...results].sort((a, b) => {
      if (!a.match_date && !b.match_date) return 0;
      if (!a.match_date) return 1;
      if (!b.match_date) return -1;
      return b.match_date.localeCompare(a.match_date);
    });
    if (sortedResults.length > 0) {
      const lastMatch = sortedResults[0];
      const firstMatch = sortedResults[Math.min(4, sortedResults.length - 1)];
      if (lastMatch.match_date) endDate = lastMatch.match_date;
      if (firstMatch.match_date) startDate = firstMatch.match_date;
    }
  } else if (preset === 'season') {
    // Find active leagues (leagues with most recent matches)
    if (results.length === 0) {
      // No matches, clear dates
      startDate = '';
      endDate = '';
    } else {
      // Find most recent match date
      const sortedResults = [...results].sort((a, b) => {
        if (!a.match_date && !b.match_date) return 0;
        if (!a.match_date) return 1;
        if (!b.match_date) return -1;
        return b.match_date.localeCompare(a.match_date);
      });
      
      const mostRecentMatch = sortedResults[0];
      if (!mostRecentMatch || !mostRecentMatch.match_date) {
        // Fallback - clear dates
        startDate = '';
        endDate = '';
      } else {
        // Find all series that have matches within last 14 days of most recent match
        // This ensures we only get currently active leagues, not old seasons
        const mostRecentDate = new Date(mostRecentMatch.match_date + 'T00:00:00');
        const cutoffDate = new Date(mostRecentDate);
        cutoffDate.setDate(cutoffDate.getDate() - 14); // 14 days before most recent match
        const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
        
        // Get unique series that have matches after cutoff date (use normalized names)
        const activeSeries = new Set();
        results.forEach(m => {
          if (m.series && m.match_date && m.match_date >= cutoffDateStr) {
            const normalizedName = normalizeSeriesName(m.series);
            activeSeries.add(normalizedName);
          }
        });
        
        // If no active series found in 14 days, look at top 5 most recent matches
        // and get their series (handles case where leagues have gaps)
        if (activeSeries.size === 0) {
          sortedResults.slice(0, 5).forEach(m => {
            if (m.series) {
              const normalizedName = normalizeSeriesName(m.series);
              activeSeries.add(normalizedName);
            }
          });
        }
        
        // Select only active series in the dropdown (dropdown uses normalized names)
        if (seriesSelect.options.length > 0 && activeSeries.size > 0) {
          Array.from(seriesSelect.options).forEach(opt => {
            opt.selected = activeSeries.has(opt.value);
          });
        }
        
        // Set date range to cover active league period
        // Find earliest match date in active series (need to map normalized back to original)
        const activeOriginalSeries = new Set();
        activeSeries.forEach(normalizedName => {
          const originalNames = seriesNameMapping[normalizedName] || [normalizedName];
          originalNames.forEach(orig => activeOriginalSeries.add(orig));
        });
        const activeMatches = results.filter(m => 
          m.series && activeOriginalSeries.has(m.series) && m.match_date
        );
        if (activeMatches.length > 0) {
          const activeDates = activeMatches.map(m => m.match_date).sort();
          startDate = activeDates[0];
          endDate = mostRecentMatch.match_date;
        } else {
          // Fallback - clear dates and rely on series filter only
          startDate = '';
          endDate = '';
        }
      }
    }
  } else if (preset === 'last3months') {
    // Last 90 days
    const now = new Date();
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setDate(threeMonthsAgo.getDate() - 90);
    startDate = threeMonthsAgo.toISOString().split('T')[0];
    endDate = now.toISOString().split('T')[0];
  }
  
  startDateInput.value = startDate;
  endDateInput.value = endDate;
  
  // Select all series for presets
  if (seriesSelect.options.length > 0) {
    Array.from(seriesSelect.options).forEach(opt => {
      opt.selected = true;
    });
  }
  
  // Sync to mobile
  syncMobileDesktopFilters('desktop-to-mobile');
  
  updateActiveFilters();
  
  if (isAutoApplyEnabled()) {
    applyFilters();
  }
}

// Clear all filters
function clearFilters() {
  const startDateInput = document.getElementById('startDate');
  const endDateInput = document.getElementById('endDate');
  const seriesSelect = document.getElementById('seriesSelect');
  const startDateMobile = document.getElementById('startDateMobile');
  const endDateMobile = document.getElementById('endDateMobile');
  const seriesSelectMobile = document.getElementById('seriesSelectMobile');
  
  if (startDateInput) startDateInput.value = '';
  if (endDateInput) endDateInput.value = '';
  if (startDateMobile) startDateMobile.value = '';
  if (endDateMobile) endDateMobile.value = '';
  
  if (seriesSelect && seriesSelect.options.length > 0) {
    Array.from(seriesSelect.options).forEach(opt => {
      opt.selected = true;
    });
  }
  
  if (seriesSelectMobile && seriesSelectMobile.options.length > 0) {
    Array.from(seriesSelectMobile.options).forEach(opt => {
      opt.selected = true;
    });
  }
  
  updateActiveFilters();
  applyFilters();
}

// Update active filter indicators
function updateActiveFilters() {
  // Sync inputs first to ensure both mobile and desktop have same values
  syncMobileDesktopFilters('both');
  
  const activeFiltersContainer = document.getElementById('activeFilters');
  const activeFiltersDesktop = document.getElementById('activeFiltersDesktop');
  const filterBadge = document.getElementById('filterBadge');
  
  const startDateInput = document.getElementById('startDate');
  const endDateInput = document.getElementById('endDate');
  const seriesSelect = document.getElementById('seriesSelect');
  
  const chips = [];
  
  if (startDateInput && startDateInput.value) {
    chips.push({
      type: 'startDate',
      label: `From: ${formatHumanDate(startDateInput.value)}`,
      remove: () => {
        startDateInput.value = '';
        const startDateMobile = document.getElementById('startDateMobile');
        if (startDateMobile) startDateMobile.value = '';
        updateActiveFilters();
        if (isAutoApplyEnabled()) {
          applyFilters();
        }
      }
    });
  }
  
  if (endDateInput && endDateInput.value) {
    chips.push({
      type: 'endDate',
      label: `To: ${formatHumanDate(endDateInput.value)}`,
      remove: () => {
        endDateInput.value = '';
        const endDateMobile = document.getElementById('endDateMobile');
        if (endDateMobile) endDateMobile.value = '';
        updateActiveFilters();
        if (isAutoApplyEnabled()) {
          applyFilters();
        }
      }
    });
  }
  
  if (seriesSelect) {
    const selectedSeries = Array.from(seriesSelect.selectedOptions);
    const allSeries = Array.from(seriesSelect.options);
    if (selectedSeries.length > 0 && selectedSeries.length < allSeries.length) {
      chips.push({
        type: 'series',
        label: `${selectedSeries.length} series selected`,
        remove: () => {
          allSeries.forEach(opt => opt.selected = true);
          const seriesSelectMobile = document.getElementById('seriesSelectMobile');
          if (seriesSelectMobile) {
            Array.from(seriesSelectMobile.options).forEach(opt => opt.selected = true);
          }
          updateActiveFilters();
          if (isAutoApplyEnabled()) {
            applyFilters();
          }
        }
      });
    }
  }
  
  const chipsHTML = chips.length > 0 ? chips.map(chip => `
    <div class="filter-chip">
      <span>${chip.label}</span>
      <button type="button" aria-label="Remove ${chip.label} filter">×</button>
    </div>
  `).join('') : '';
  
  // Update mobile container
  if (activeFiltersContainer) {
    activeFiltersContainer.innerHTML = chipsHTML;
    activeFiltersContainer.querySelectorAll('.filter-chip button').forEach((btn, index) => {
      btn.addEventListener('click', chips[index].remove);
    });
  }
  
  // Update desktop container
  if (activeFiltersDesktop) {
    activeFiltersDesktop.innerHTML = chipsHTML;
    activeFiltersDesktop.querySelectorAll('.filter-chip button').forEach((btn, index) => {
      btn.addEventListener('click', chips[index].remove);
    });
  }
  
  // Update badge on filter icon
  if (filterBadge) {
    if (chips.length > 0) {
      filterBadge.textContent = chips.length.toString();
    } else {
      filterBadge.textContent = '';
    }
  }
}

function applyFilters() {
  try {
    // Sync mobile to desktop before applying filters
    syncMobileDesktopFilters('mobile-to-desktop');
    
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const seriesSelect = document.getElementById('seriesSelect');
    const applyBtn = document.getElementById('applyFiltersBtn');
    
    if (!startDateInput || !endDateInput || !seriesSelect) {
      devWarn('Filter elements not found, skipping filter application');
      return;
    }
    
    // Disable button during filtering
    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.setAttribute('aria-busy', 'true');
    }
    
    const startDate = startDateInput.value;
    const endDate = endDateInput.value;
    const selectedNormalizedSeries = Array.from(seriesSelect.selectedOptions).map(o => o.value);
    const numSeriesOptions = seriesSelect.options.length;
    const numSeriesSelected = seriesSelect.selectedOptions.length;
    const allSeriesSelected =
      numSeriesOptions === 0 || numSeriesSelected === numSeriesOptions;

    // Map normalized series names back to original series names for filtering
    const selectedOriginalSeries = new Set();
    selectedNormalizedSeries.forEach(normalizedName => {
      const originalNames = seriesNameMapping[normalizedName] || [normalizedName];
      originalNames.forEach(orig => selectedOriginalSeries.add(orig));
    });
    
    // Filter match results - all dates are now in YYYY-MM-DD format
    filteredData.matchResults = (allData.matchResults || []).filter(m => {
      // If date filters are set, only filter by date if match has a date
      if (m.match_date) {
        // Only apply date filters if they are explicitly set (not empty)
        // Both filter dates (from HTML inputs) and match dates are in YYYY-MM-DD format
        if (startDate && startDate.trim() && m.match_date < startDate) return false;
        if (endDate && endDate.trim() && m.match_date > endDate) return false;
      }
      // When every series in the dropdown is selected, do not filter by series (same as "all competitions").
      // Otherwise subset selections only show matches whose original series maps to a selected option.
      if (
        !allSeriesSelected &&
        selectedOriginalSeries.size > 0 &&
        m.series &&
        !selectedOriginalSeries.has(m.series)
      ) {
        return false;
      }
      return true;
    });
    
    // Create a Set of valid match identifiers for filtering stats
    // Use date + "|" + opponent as the key to match against recent_batting/recent_bowling entries
    filteredData.validMatchKeys = new Set();
    const allMatchKeys = new Set();
    
    // Create a set of filtered match keys for quick lookup
    const filteredMatchKeys = new Set();
    filteredData.matchResults.forEach(m => {
      if (m.match_date && m.opponent) {
        const key = `${m.match_date}|${m.opponent}`;
        filteredMatchKeys.add(key);
      }
    });
    
    // Build sets of all match keys and filtered match keys
    (allData.matchResults || []).forEach(m => {
      if (m.match_date && m.opponent) {
        const key = `${m.match_date}|${m.opponent}`;
        allMatchKeys.add(key);
        if (filteredMatchKeys.has(key)) {
          filteredData.validMatchKeys.add(key);
        }
      }
    });
    
    // If no filters are active (all matches are included), clear validMatchKeys to use all-time stats
    if (filteredData.validMatchKeys.size === allMatchKeys.size && allMatchKeys.size > 0) {
      filteredData.validMatchKeys = null;
    }
    
    // Player stats and team analytics - use all data (filtering by match would require match-level data in stats)
    filteredData.stats = allData.stats || {};
    filteredData.teamAnalytics = allData.teamAnalytics || {};

    renderHome();
    renderTeamStats();
    loadPlayerData();
    
    // Update active filter indicators
    updateActiveFilters();
    
    // Convert tables to cards on mobile
    setTimeout(convertAllTablesToCards, 100);
    
    // Re-enable button
    if (applyBtn) {
      applyBtn.disabled = false;
      applyBtn.removeAttribute('aria-busy');
    }
  } catch (e) {
    logError('Error in applyFilters:', e);
    const applyBtn = document.getElementById('applyFiltersBtn');
    if (applyBtn) {
      applyBtn.disabled = false;
      applyBtn.removeAttribute('aria-busy');
    }
  }
}

function filterStatsRowsByMatchKeys(rows, validMatchKeys) {
  if (!validMatchKeys || validMatchKeys.size === 0) return rows || [];
  return (rows || []).filter(r => {
    if (!r || !r.date || !r.opponent) return false;
    const k = `${r.date}|${String(r.opponent).trim()}`;
    return validMatchKeys.has(k);
  });
}

/**
 * When date/series filters are active, re-derive player sections that are otherwise all-time
 * (card, positions, grounds, dismissals, PoM, recent lists) from batting_innings / bowling_spells.
 */
function derivePlayerStatsForFilter(ps, validMatchKeys) {
  if (!validMatchKeys || validMatchKeys.size === 0) return ps;

  const batPool =
    ps.batting_innings && ps.batting_innings.length > 0
      ? ps.batting_innings
      : ps.recent_batting || [];
  const bowlPool =
    ps.bowling_spells && ps.bowling_spells.length > 0
      ? ps.bowling_spells
      : ps.recent_bowling || [];
  const batRows = filterStatsRowsByMatchKeys(batPool, validMatchKeys);
  const bowlRows = filterStatsRowsByMatchKeys(bowlPool, validMatchKeys);

  const out = { ...ps };

  let bruns = 0;
  let bballs = 0;
  let b4 = 0;
  let b6 = 0;
  let bouts = 0;
  let bdb = 0;
  let bbp = 0;
  for (const r of batRows) {
    bruns += r.runs || 0;
    bballs += r.balls || 0;
    b4 += r['4s'] || 0;
    b6 += r['6s'] || 0;
    bouts += r.is_out ? 1 : 0;
    bdb += r.bat_dot_balls || 0;
    bbp += r.bat_bbp_balls || 0;
  }
  out.runs = bruns;
  out.balls = bballs;
  out['4s'] = b4;
  out['6s'] = b6;
  out.outs = bouts;
  out.sr = bballs > 0 ? Math.round((bruns / bballs) * 1000) / 10 : 0;
  out.avg = bouts > 0 ? Math.round((bruns / bouts) * 100) / 100 : 0;

  if (bbp > 0) {
    out.bat_dot_pct = Math.round((bdb / bbp) * 1000) / 10;
    out.bat_dot_balls = bdb;
    out.bat_tracked_balls = bbp;
    if (out.dot_pct === undefined) out.dot_pct = out.bat_dot_pct;
  } else {
    out.bat_dot_pct = 0;
    out.bat_dot_balls = 0;
    out.bat_tracked_balls = 0;
  }

  const byPos = {};
  for (const r of batRows) {
    if (r.position == null) continue;
    const pk = String(r.position);
    if (!byPos[pk]) byPos[pk] = { runs: 0, balls: 0, outs: 0, innings: 0 };
    byPos[pk].runs += r.runs || 0;
    byPos[pk].balls += r.balls || 0;
    byPos[pk].outs += r.is_out ? 1 : 0;
    byPos[pk].innings += 1;
  }
  const position_stats = {};
  Object.keys(byPos).forEach(pk => {
    const g = byPos[pk];
    const sr = g.balls > 0 ? Math.round((g.runs / g.balls) * 1000) / 10 : 0;
    const avg = g.outs > 0 ? Math.round((g.runs / g.outs) * 100) / 100 : 0;
    position_stats[pk] = {
      runs: g.runs,
      balls: g.balls,
      outs: g.outs,
      innings: g.innings,
      sr,
      avg,
    };
  });
  out.position_stats = position_stats;

  const byG = {};
  for (const r of batRows) {
    if (!r.ground) continue;
    const gk = r.ground;
    if (!byG[gk]) byG[gk] = { runs: 0, balls: 0, outs: 0, innings: 0 };
    byG[gk].runs += r.runs || 0;
    byG[gk].balls += r.balls || 0;
    byG[gk].outs += r.is_out ? 1 : 0;
    byG[gk].innings += 1;
  }
  const ground_stats = {};
  Object.keys(byG).forEach(gk => {
    const g = byG[gk];
    const sr = g.balls > 0 ? Math.round((g.runs / g.balls) * 1000) / 10 : 0;
    const avg = g.outs > 0 ? Math.round((g.runs / g.outs) * 100) / 100 : 0;
    ground_stats[gk] = {
      runs: g.runs,
      balls: g.balls,
      innings: g.innings,
      sr,
      avg,
    };
  });
  out.ground_stats = ground_stats;

  const dcounts = {};
  for (const r of batRows) {
    const d = r.dismissal || 'other';
    dcounts[d] = (dcounts[d] || 0) + 1;
  }
  const nbat = batRows.length;
  const dismissal_stats = {};
  if (nbat > 0) {
    Object.keys(dcounts).forEach(d => {
      dismissal_stats[d] = {
        count: dcounts[d],
        pct: Math.round((dcounts[d] / nbat) * 1000) / 10,
      };
    });
  }
  out.dismissal_stats = dismissal_stats;

  const sortedBat = [...batRows].sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || ''))
  );
  out.recent_batting = sortedBat.slice(0, 5).map(r => ({
    runs: r.runs,
    balls: r.balls,
    date: r.date,
    opponent: r.opponent,
  }));

  let wk = 0;
  let rc = 0;
  let tb = 0;
  let tdots = 0;
  for (const r of bowlRows) {
    wk += r.wickets || 0;
    rc += r.runs || 0;
    const b =
      r.balls != null && r.balls > 0
        ? r.balls
        : (() => {
            const overs = r.overs || 0;
            const wo = Math.floor(overs);
            const bi = Math.round((overs % 1) * 10);
            return wo * 6 + bi;
          })();
    tb += b;
    tdots += r.dots || 0;
  }
  out.wickets = wk;
  out.runs_conceded = rc;
  out.overs = Math.floor(tb / 6) + (tb % 6) / 10;
  out.econ = tb > 0 ? Math.round((rc / tb) * 6 * 100) / 100 : 0;
  out.dot_balls = tdots;
  out.bowl_dot_pct = tb > 0 ? Math.round((tdots / tb) * 1000) / 10 : 0;
  out.bowl_total_balls = tb;

  const sortedBowl = [...bowlRows].sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || ''))
  );
  out.recent_bowling = sortedBowl.slice(0, 5).map(r => ({
    wickets: r.wickets,
    runs: r.runs,
    overs: r.overs,
    date: r.date,
    opponent: r.opponent,
  }));

  const byBg = {};
  for (const r of bowlRows) {
    if (!r.ground) continue;
    if (!byBg[r.ground]) {
      byBg[r.ground] = { innings: 0, balls: 0, wickets: 0, runs: 0, dots: 0 };
    }
    byBg[r.ground].innings += 1;
    const b =
      r.balls != null && r.balls > 0
        ? r.balls
        : (() => {
            const overs = r.overs || 0;
            const wo = Math.floor(overs);
            const bi = Math.round((overs % 1) * 10);
            return wo * 6 + bi;
          })();
    byBg[r.ground].balls += b;
    byBg[r.ground].wickets += r.wickets || 0;
    byBg[r.ground].runs += r.runs || 0;
    byBg[r.ground].dots += r.dots || 0;
  }
  const bowl_ground_stats = {};
  Object.keys(byBg).forEach(gk => {
    const g = byBg[gk];
    const dotPct = g.balls > 0 ? Math.round((g.dots / g.balls) * 1000) / 10 : 0;
    const econ = g.balls > 0 ? Math.round((g.runs / g.balls) * 6 * 100) / 100 : 0;
    const overs = Math.floor(g.balls / 6) + (g.balls % 6) / 10;
    bowl_ground_stats[gk] = {
      innings: g.innings,
      overs,
      dot_pct: dotPct,
      wickets: g.wickets,
      econ,
    };
  });
  out.bowl_ground_stats = bowl_ground_stats;

  const poms = (ps.pom_matches || []).filter(m => {
    if (!m || !m.date || !m.opponent) return false;
    const k = `${m.date}|${String(m.opponent).trim()}`;
    return validMatchKeys.has(k);
  });
  out.pom_matches = poms;
  out.pom_count = poms.length;

  out.best_batting = sortedBat.slice(0, 3).map(r => `${r.runs} (${r.balls}b)`);
  out.best_bowling = sortedBowl.slice(0, 3).map(r => {
    const o = r.overs != null ? r.overs : 0;
    return `${r.wickets || 0}/${r.runs || 0} (${o} ov)`;
  });

  return out;
}

// Helper function to recalculate stats from filtered match-level data (home page top lists)
function calculateFilteredStats(playerStats, validMatchKeys) {
  if (!validMatchKeys || validMatchKeys.size === 0) {
    return null;
  }

  const filteredStats = {
    runs: 0,
    balls: 0,
    '4s': 0,
    '6s': 0,
    wickets: 0,
    overs: 0,
    runs_conceded: 0,
    dot_balls: 0,
    wides: 0,
    noballs: 0,
  };

  const batPool =
    playerStats.batting_innings && playerStats.batting_innings.length > 0
      ? playerStats.batting_innings
      : playerStats.recent_batting || [];
  const filteredBatting = filterStatsRowsByMatchKeys(
    Array.isArray(batPool) ? batPool : [],
    validMatchKeys
  );

  let summed4s6sFromRows = false;
  filteredBatting.forEach(match => {
    filteredStats.runs += match.runs || 0;
    filteredStats.balls += match.balls || 0;
    if (Object.prototype.hasOwnProperty.call(match, '4s')) {
      filteredStats['4s'] += match['4s'] || 0;
      summed4s6sFromRows = true;
    }
    if (Object.prototype.hasOwnProperty.call(match, '6s')) {
      filteredStats['6s'] += match['6s'] || 0;
      summed4s6sFromRows = true;
    }
  });

  if (filteredStats.balls > 0) {
    filteredStats.sr = Math.round((filteredStats.runs / filteredStats.balls) * 1000) / 10;
  } else {
    filteredStats.sr = 0;
  }

  const bowlPool =
    playerStats.bowling_spells && playerStats.bowling_spells.length > 0
      ? playerStats.bowling_spells
      : playerStats.recent_bowling || [];
  const filteredBowling = filterStatsRowsByMatchKeys(
    Array.isArray(bowlPool) ? bowlPool : [],
    validMatchKeys
  );

  let totalBalls = 0;
  let summedDotsFromRows = false;
  filteredBowling.forEach(match => {
    filteredStats.wickets += match.wickets || 0;
    filteredStats.runs_conceded += match.runs || 0;
    const balls =
      match.balls != null && match.balls > 0
        ? match.balls
        : (() => {
            const overs = match.overs || 0;
            const wholeOvers = Math.floor(overs);
            const ballsInOver = Math.round((overs % 1) * 10);
            return wholeOvers * 6 + ballsInOver;
          })();
    totalBalls += balls;
    if (Object.prototype.hasOwnProperty.call(match, 'dots')) {
      filteredStats.dot_balls += match.dots || 0;
      summedDotsFromRows = true;
    }
  });

  filteredStats._totalBalls = totalBalls;
  filteredStats.overs = Math.floor(totalBalls / 6) + (totalBalls % 6) / 10;

  if (totalBalls > 0) {
    filteredStats.econ = (filteredStats.runs_conceded / totalBalls) * 6;
  } else {
    filteredStats.econ = 0;
  }

  if (filteredStats.wickets > 0) {
    filteredStats.bowl_sr = totalBalls / filteredStats.wickets;
  } else {
    filteredStats.bowl_sr = 0;
  }

  if (summedDotsFromRows && totalBalls > 0) {
    filteredStats.bowl_dot_pct =
      Math.round((filteredStats.dot_balls / totalBalls) * 1000) / 10;
  }

  if (
    !summed4s6sFromRows &&
    filteredStats.runs > 0 &&
    playerStats.runs > 0 &&
    playerStats['4s'] !== undefined
  ) {
    const runsRatio = filteredStats.runs / playerStats.runs;
    filteredStats['4s'] = Math.round((playerStats['4s'] || 0) * runsRatio);
    filteredStats['6s'] = Math.round((playerStats['6s'] || 0) * runsRatio);
  } else if (
    !summed4s6sFromRows &&
    filteredStats.balls > 0 &&
    playerStats.balls > 0 &&
    playerStats['4s'] !== undefined
  ) {
    const ballsRatio = filteredStats.balls / playerStats.balls;
    filteredStats['4s'] = Math.round((playerStats['4s'] || 0) * ballsRatio);
    filteredStats['6s'] = Math.round((playerStats['6s'] || 0) * ballsRatio);
  }

  const tb = filteredStats._totalBalls || 0;
  if (
    !summedDotsFromRows &&
    tb > 0 &&
    playerStats.bowl_total_balls > 0 &&
    playerStats.dot_balls !== undefined
  ) {
    const ballsRatio = tb / playerStats.bowl_total_balls;
    filteredStats.dot_balls = Math.round((playerStats.dot_balls || 0) * ballsRatio);
    filteredStats.dot_balls = Math.min(filteredStats.dot_balls, tb);
    filteredStats.bowl_dot_pct =
      tb > 0 ? Math.round((filteredStats.dot_balls / tb) * 1000) / 10 : 0;
  } else if (
    !summedDotsFromRows &&
    tb > 0 &&
    playerStats.overs > 0 &&
    playerStats.dot_balls !== undefined
  ) {
    const oversRatio = filteredStats.overs / playerStats.overs;
    filteredStats.dot_balls = Math.round((playerStats.dot_balls || 0) * oversRatio);
    filteredStats.dot_balls = Math.min(filteredStats.dot_balls, tb);
    filteredStats.bowl_dot_pct =
      tb > 0 ? Math.round((filteredStats.dot_balls / tb) * 1000) / 10 : 0;
  }

  delete filteredStats._totalBalls;

  return filteredStats;
}

function escapeHtmlCell(s) {
  if (s == null || s === '') return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatMatchResultCell(m) {
  const r = m.result || '-';
  const d = m.result_detail;
  const main = escapeHtmlCell(r);
  if (!d) return main;
  return `${main} <span class="result-detail" aria-label="${escapeHtmlCell(d)}">${escapeHtmlCell(d)}</span>`;
}

function renderHome() {
  try {
    // Recent match results (see HOME_RECENT_RESULTS_LIMIT)
    const tbody = document.querySelector('#last5Results tbody');
    if (!tbody) return;
    
    const results = filteredData.matchResults || allData.matchResults || [];
    if (results.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#64748B;">No match results available. Run analyze.py to generate data.</td></tr>';
    } else {
      const sortedResults = [...results].sort((a, b) => {
        if (!a.match_date && !b.match_date) return 0;
        if (!a.match_date) return 1;
        if (!b.match_date) return -1;
        return b.match_date.localeCompare(a.match_date);
      });
      tbody.innerHTML = sortedResults.slice(0, HOME_RECENT_RESULTS_LIMIT).map(m => {
        const normalizedSeries = m.series ? normalizeSeriesName(m.series) : '-';
        return `<tr><td>${formatHumanDate(m.match_date)}</td><td>${escapeHtmlCell(m.opponent || '-')}</td><td>${formatMatchResultCell(m)}</td><td>${formatMatchType(m.match_type)}</td><td>${escapeHtmlCell(m.ground || '-')}</td><td>${normalizedSeries}</td></tr>`;
      }).join('');
    }
    
    // Top batsmen - recalculate stats from filtered match-level data if filters are active
    const allStats = allData.stats || {};
    let players = [];
    
    if (filteredData.validMatchKeys && filteredData.validMatchKeys.size > 0) {
      players = Object.entries(allStats)
        .filter(([name, s]) => s.runs !== undefined)
        .map(([name, s]) => {
          const filteredStats = calculateFilteredStats(s, filteredData.validMatchKeys);
          if (filteredStats && (filteredStats.runs > 0 || filteredStats.balls > 0)) {
            return [name, { ...s, ...filteredStats }];
          }
          return null;
        })
        .filter(x => x !== null);
    } else {
      players = Object.entries(allStats).filter(([name, s]) => s.runs !== undefined);
    }
    
    const topSR = players.filter(([n, s]) => s.balls >= 20).sort((a, b) => (b[1].sr || 0) - (a[1].sr || 0)).slice(0, 5);
    const topRuns = players.sort((a, b) => (b[1].runs || 0) - (a[1].runs || 0)).slice(0, 5);
    const top4s = players.sort((a, b) => (b[1]['4s'] || 0) - (a[1]['4s'] || 0)).slice(0, 5);
    const top6s = players.sort((a, b) => (b[1]['6s'] || 0) - (a[1]['6s'] || 0)).slice(0, 5);
    
    const topSRElem = document.getElementById('topSR');
    const topRunsElem = document.getElementById('topRuns');
    const top4sElem = document.getElementById('top4s');
    const top6sElem = document.getElementById('top6s');
    
    if (topSRElem) topSRElem.innerHTML = topSR.map(([n, s]) => `<li><span>${n}</span><span>${(s.sr || 0).toFixed(1)}</span></li>`).join('');
    if (topRunsElem) topRunsElem.innerHTML = topRuns.map(([n, s]) => `<li><span>${n}</span><span>${s.runs || 0}</span></li>`).join('');
    if (top4sElem) top4sElem.innerHTML = top4s.map(([n, s]) => `<li><span>${n}</span><span>${s['4s'] || 0}</span></li>`).join('');
    if (top6sElem) top6sElem.innerHTML = top6s.map(([n, s]) => `<li><span>${n}</span><span>${s['6s'] || 0}</span></li>`).join('');
    
    // Top bowlers - recalculate stats from filtered match-level data if filters are active
    let bowlers = [];
    
    if (filteredData.validMatchKeys && filteredData.validMatchKeys.size > 0) {
      bowlers = Object.entries(allStats)
        .filter(([name, s]) => s.wickets !== undefined)
        .map(([name, s]) => {
          const filteredStats = calculateFilteredStats(s, filteredData.validMatchKeys);
          if (filteredStats && (filteredStats.wickets > 0 || filteredStats.overs > 0)) {
            return [name, { ...s, ...filteredStats }];
          }
          return null;
        })
        .filter(x => x !== null);
    } else {
      bowlers = Object.entries(allStats).filter(([name, s]) => s.wickets !== undefined);
    }
    
    const topWickets = bowlers.sort((a, b) => (b[1].wickets || 0) - (a[1].wickets || 0)).slice(0, 5);
    const topDots = bowlers.filter(([n, s]) => {
      const totalBalls = (s.overs || 0) * 6;
      return totalBalls > 0;
    }).sort((a, b) => {
      const ballsA = (a[1].overs || 0) * 6;
      const ballsB = (b[1].overs || 0) * 6;
      const dotPctA = a[1].bowl_dot_pct || ((a[1].dot_balls || 0) / (ballsA || 1)) * 100;
      const dotPctB = b[1].bowl_dot_pct || ((b[1].dot_balls || 0) / (ballsB || 1)) * 100;
      return dotPctB - dotPctA;
    }).slice(0, 5);
    const topEcon = bowlers.filter(([n, s]) => s.overs > 0).sort((a, b) => (a[1].econ || 999) - (b[1].econ || 999)).slice(0, 5);
    const topBowlSR = bowlers.filter(([n, s]) => s.wickets > 0).sort((a, b) => {
      const ballsA = (a[1].overs || 0) * 6;
      const ballsB = (b[1].overs || 0) * 6;
      const srA = ballsA / (a[1].wickets || 1);
      const srB = ballsB / (b[1].wickets || 1);
      return srA - srB;
    }).slice(0, 5);
    
    const topWicketsElem = document.getElementById('topWickets');
    const topDotsElem = document.getElementById('topDots');
    const topEconElem = document.getElementById('topEcon');
    const topBowlSRElem = document.getElementById('topBowlSR');
    
    if (topWicketsElem) topWicketsElem.innerHTML = topWickets.map(([n, s]) => `<li><span>${n}</span><span>${s.wickets || 0}</span></li>`).join('');
    if (topDotsElem) topDotsElem.innerHTML = topDots.map(([n, s]) => {
      const totalBalls = (s.overs || 0) * 6;
      let dotPct = s.bowl_dot_pct;
      if (dotPct === undefined || dotPct === null) {
        dotPct = totalBalls > 0 ? ((s.dot_balls || 0) / totalBalls) * 100 : 0;
      }
      dotPct = Math.min(dotPct, 100);
      return `<li><span>${n}</span><span>${dotPct.toFixed(1)}%</span></li>`;
    }).join('');
    if (topEconElem) topEconElem.innerHTML = topEcon.map(([n, s]) => `<li><span>${n}</span><span>${s.econ?.toFixed(2) || 0}</span></li>`).join('');
    if (topBowlSRElem) topBowlSRElem.innerHTML = topBowlSR.map(([n, s]) => {
      const balls = (s.overs || 0) * 6;
      const sr = (balls / (s.wickets || 1)).toFixed(1);
      return `<li><span>${n}</span><span>${sr}</span></li>`;
    }).join('');
    
    // Player of Match - filter to only Royals players and show photos
    const pomSection = document.getElementById('pomSection');
    if (pomSection) {
      const pomResults = filteredData.matchResults || allData.matchResults || [];
      const useRosterFilter = rosterNames.size > 0;
      const stats = Object.keys(filteredData.stats || {}).length > 0 ? filteredData.stats : (allData.stats || {});
      
      const pomMatches = pomResults.filter(m => {
        if (!m.player_of_match) return false;
        
        if (useRosterFilter) {
          return isRoyalsPlayer(m.player_of_match);
        } else {
          const normalized = normalizePlayerName(m.player_of_match);
          return stats[normalized] !== undefined;
        }
      }).slice(0, 5);
      
      if (pomMatches.length === 0) {
        pomSection.innerHTML = '<p style="color:#64748B;">No Recent MoM awards for Royals players in selected period.</p>';
      } else {
        pomSection.innerHTML = pomMatches.map(m => {
          const playerName = normalizePlayerName(m.player_of_match);
          let photoUrl = rosterMap[playerName];
          if (!photoUrl) {
            for (const [rosterName, url] of Object.entries(rosterMap)) {
              if (rosterName.toLowerCase() === playerName.toLowerCase()) {
                photoUrl = url;
                break;
              }
            }
          }
          if (!photoUrl && allData.photos && allData.photos[playerName]) {
            photoUrl = allData.photos[playerName];
          }
          if (!photoUrl) {
            photoUrl = 'https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png';
          }
          
          return `
            <div class="player-card" style="margin:8px 0">
              <img src="${photoUrl}" alt="${m.player_of_match}" style="width:60px; height:60px; object-fit:cover; border-radius:50%; border:2px solid #E2E8F0; margin:0">
              <div style="flex:1">
                <div><strong>${m.player_of_match}</strong></div>
                <div style="margin-top:4px; color:#64748B; font-size:14px">${formatHumanDate(m.match_date)} vs ${m.opponent || ''}</div>
              </div>
            </div>
          `;
        }).join('');
      }
    }
  } catch (e) {
    logError('Error in renderHome:', e);
  }
}

/** Same exclusions as analyze.NON_PLAYED_RESULT_DETAILS for W/L aggregates. */
const NON_PLAYED_RESULT_DETAILS_AGG = new Set(['Forfeit', 'Abandoned', 'No result']);

function matchCountsTowardRecordStatsAgg(m) {
  const rd = m && m.result_detail;
  if (rd == null || rd === '') return true;
  return !NON_PLAYED_RESULT_DETAILS_AGG.has(String(rd).trim());
}

/**
 * Rebuild win_rate_by_ground / toss / match_type from match_results (aligned with analyze.build_team_analytics).
 */
function buildTeamAnalyticsFromMatches(matches) {
  const rows = (matches || []).filter(matchCountsTowardRecordStatsAgg);
  const out = {
    overall_win_pct: 0,
    win_rate_by_ground: {},
    win_rate_by_toss: {},
    win_rate_by_match_type: {},
  };
  if (rows.length === 0) return out;

  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const m of rows) {
    const r = m.result;
    if (r === 'Win') wins += 1;
    else if (r === 'Loss') losses += 1;
    else if (r === 'Draw' || r === 'Tie') draws += 1;
  }
  const totalM = wins + losses + draws;
  if (totalM > 0) {
    out.overall_win_pct = Math.round((wins / totalM) * 1000) / 10;
  }

  const groundStats = {};
  for (const m of rows) {
    const ground = m.ground;
    const result = m.result;
    if (!ground) continue;
    if (!groundStats[ground]) groundStats[ground] = { wins: 0, losses: 0, draws: 0 };
    if (result === 'Win') groundStats[ground].wins += 1;
    else if (result === 'Loss') groundStats[ground].losses += 1;
    else if (result === 'Draw' || result === 'Tie') groundStats[ground].draws += 1;
  }
  for (const [g, stats] of Object.entries(groundStats)) {
    const t = stats.wins + stats.losses + stats.draws;
    if (t > 0) {
      out.win_rate_by_ground[g] = {
        win_pct: Math.round((stats.wins / t) * 1000) / 10,
        wins: stats.wins,
        losses: stats.losses,
        draws: stats.draws,
        total: t,
      };
    }
  }

  const tossStats = {};
  for (const m of rows) {
    const tossDecision = m.toss_decision;
    const result = m.result;
    if (!tossDecision) continue;
    if (!tossStats[tossDecision]) tossStats[tossDecision] = { wins: 0, losses: 0, draws: 0 };
    if (result === 'Win') tossStats[tossDecision].wins += 1;
    else if (result === 'Loss') tossStats[tossDecision].losses += 1;
    else if (result === 'Draw' || result === 'Tie') tossStats[tossDecision].draws += 1;
  }
  for (const [tKey, stats] of Object.entries(tossStats)) {
    const t = stats.wins + stats.losses + stats.draws;
    if (t > 0) {
      out.win_rate_by_toss[tKey] = {
        win_pct: Math.round((stats.wins / t) * 1000) / 10,
        wins: stats.wins,
        losses: stats.losses,
        draws: stats.draws,
        total: t,
      };
    }
  }

  const matchTypeStats = {
    League: { wins: 0, losses: 0, draws: 0 },
    Playoff: { wins: 0, losses: 0, draws: 0 },
  };
  const playoffRe = /(quarter|semi|final|eliminator|playoff)/i;
  for (const m of rows) {
    const mt = m.match_type || '';
    const bucket = playoffRe.test(String(mt)) ? 'Playoff' : 'League';
    const result = m.result;
    if (result === 'Win') matchTypeStats[bucket].wins += 1;
    else if (result === 'Loss') matchTypeStats[bucket].losses += 1;
    else if (result === 'Draw' || result === 'Tie') matchTypeStats[bucket].draws += 1;
  }
  for (const [mt, stats] of Object.entries(matchTypeStats)) {
    const t = stats.wins + stats.losses + stats.draws;
    if (t > 0) {
      out.win_rate_by_match_type[mt] = {
        win_pct: Math.round((stats.wins / t) * 1000) / 10,
        wins: stats.wins,
        losses: stats.losses,
        draws: stats.draws,
        total: t,
      };
    }
  }

  return out;
}

function renderTeamStats() {
  try {
    const serverTa = filteredData.teamAnalytics || allData.teamAnalytics || {};
    const filteredMr = filteredData.matchResults || allData.matchResults || [];
    const computed = buildTeamAnalyticsFromMatches(filteredMr);
    const ta = {
      ...serverTa,
      win_rate_by_ground: computed.win_rate_by_ground,
      win_rate_by_toss: computed.win_rate_by_toss,
      win_rate_by_match_type: computed.win_rate_by_match_type,
    };

    renderFormMomentum();
    
    const groundTbody = document.querySelector('#winByGround tbody');
    if (groundTbody) {
      const groundData = ta.win_rate_by_ground || {};
      if (Object.keys(groundData).length === 0) {
        groundTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#64748B;">No data available. Run analyze.py to generate team analytics.</td></tr>';
      } else {
        groundTbody.innerHTML = Object.entries(groundData).map(([g, s]) =>
          `<tr><td>${g}</td><td>${s.wins}</td><td>${s.losses}</td><td>${s.draws}</td><td>${s.win_pct}%</td></tr>`
        ).join('');
      }
    }
    
    const tossTbody = document.querySelector('#winByToss tbody');
    if (tossTbody) {
      const tossData = ta.win_rate_by_toss || {};
      if (Object.keys(tossData).length === 0) {
        tossTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#64748B;">No data available.</td></tr>';
      } else {
        tossTbody.innerHTML = Object.entries(tossData).map(([t, s]) =>
          `<tr><td>${t}</td><td>${s.wins}</td><td>${s.losses}</td><td>${s.draws}</td><td>${s.win_pct}%</td></tr>`
        ).join('');
      }
    }
    
    const matchTypeTbody = document.querySelector('#winByMatchType tbody');
    if (matchTypeTbody) {
      const matchTypeData = ta.win_rate_by_match_type || {};
      if (Object.keys(matchTypeData).length === 0) {
        matchTypeTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#64748B;">No data available.</td></tr>';
      } else {
        matchTypeTbody.innerHTML = Object.entries(matchTypeData).map(([mt, s]) =>
          `<tr><td>${mt}</td><td>${s.wins}</td><td>${s.losses}</td><td>${s.draws}</td><td>${s.win_pct}%</td></tr>`
        ).join('');
      }
    }
  } catch (e) {
    logError('Error in renderTeamStats:', e);
  }
}

// Global render function for player stats
function renderPlayer(name) {
  const stats = Object.keys(filteredData.stats || {}).length > 0 ? filteredData.stats : (allData.stats || {});
  const photos = allData.photos || {};
  const ps = stats[name];
  if (!ps) return;

  const validKeys = filteredData.validMatchKeys;
  const psDisplay = derivePlayerStatsForFilter(ps, validKeys);
  
  function fmt(v) { return (v === null || v === undefined) ? '-' : v; }
  
  const playerCard = document.getElementById('playerCard');
  if (playerCard) {
    playerCard.style.display = 'flex';
    playerCard.setAttribute('aria-label', `Statistics for ${name}`);
  }
  
  document.getElementById('pi_name').textContent = name;
  document.getElementById('pi_runs').textContent = fmt(psDisplay.runs);
  document.getElementById('pi_sr').textContent = fmt(psDisplay.sr);
  document.getElementById('pi_avg').textContent = fmt(psDisplay.avg);
  
  let batDotPct = null;
  if (psDisplay.bat_dot_pct !== undefined) {
    batDotPct = psDisplay.bat_dot_pct;
  } else if (psDisplay.bat_tracked_balls !== undefined && psDisplay.bat_tracked_balls > 0) {
    batDotPct = ((psDisplay.bat_dot_balls || 0) / psDisplay.bat_tracked_balls) * 100;
  }
  document.getElementById('pi_bat_dot').textContent = batDotPct !== null && batDotPct !== undefined ? fmt(batDotPct.toFixed(1)) : '-';
  
  document.getElementById('pi_4s').textContent = fmt(psDisplay['4s']);
  document.getElementById('pi_6s').textContent = fmt(psDisplay['6s']);
  document.getElementById('pi_wk').textContent = fmt(psDisplay.wickets);
  document.getElementById('pi_overs').textContent = fmt(psDisplay.overs?.toFixed ? psDisplay.overs.toFixed(1) : fmt(psDisplay.overs));
  document.getElementById('pi_econ').textContent = fmt(psDisplay.econ);
  
  const bowlDotPct = psDisplay.bowl_dot_pct !== undefined ? psDisplay.bowl_dot_pct :
                     (psDisplay.overs > 0 && psDisplay.dot_balls !== undefined ? ((psDisplay.dot_balls || 0) / ((psDisplay.overs || 0) * 6) * 100) : null);
  document.getElementById('pi_bowl_dot').textContent = bowlDotPct !== null ? fmt(bowlDotPct.toFixed(1)) : '-';
  
  const url = photos[name] || 'https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png';
  const playerPhoto = document.getElementById('playerPhoto');
  if (playerPhoto) {
    playerPhoto.src = url;
    playerPhoto.setAttribute('alt', `${name} photo`);
  }
  
  // Position stats
  const posTbody = document.querySelector('#positionStats tbody');
  if (posTbody) {
    // Clear existing table cards on mobile before updating table (prevents cached data)
    const posTable = document.getElementById('positionStats');
    if (posTable) {
      const posWrapper = posTable.closest('.table-wrapper');
      if (posWrapper) {
        const existingCards = posWrapper.querySelector('.table-cards');
        if (existingCards) {
          existingCards.remove();
        }
      }
    }
    
    if (psDisplay.position_stats && Object.keys(psDisplay.position_stats).length > 0) {
      posTbody.innerHTML = Object.entries(psDisplay.position_stats).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).map(([pos, pstat]) =>
        `<tr><td>${pos}</td><td>${pstat.innings || 0}</td><td>${pstat.runs}</td><td>${pstat.balls}</td><td>${pstat.sr}</td><td>${pstat.avg}</td><td>${pstat.outs}</td></tr>`
      ).join('');
    } else {
      posTbody.innerHTML = '<tr><td colspan="7">No position data</td></tr>';
    }
    
    // Recreate cards on mobile after table update
    convertTableToCards('positionStats');
  }
  
  // Dismissal stats
  const dismissalStatsElem = document.getElementById('dismissalStats');
  if (dismissalStatsElem) {
    if (psDisplay.dismissal_stats && Object.keys(psDisplay.dismissal_stats).length > 0) {
      const dismissalEntries = Object.entries(psDisplay.dismissal_stats)
        .filter(([type, data]) => data.count > 0)
        .sort((a, b) => b[1].pct - a[1].pct);
      
      const formatDismissalType = (type) => {
        const typeMap = {
          'catch': 'Catch',
          'bowled': 'Bowled',
          'run out': 'Run Out',
          'lbw': 'LBW',
          'stumped': 'Stumped',
          'not out': 'Not Out',
          'other': 'Other'
        };
        return typeMap[type] || type.charAt(0).toUpperCase() + type.slice(1);
      };
      
      dismissalStatsElem.innerHTML = dismissalEntries.map(([type, data]) =>
        `<li><span>${formatDismissalType(type)}</span><span>${data.pct}%</span></li>`
      ).join('');
    } else {
      dismissalStatsElem.innerHTML = '<li>No dismissal data available</li>';
    }
  }
  
  // Recent performances
  const recentBatting = document.getElementById('recentBatting');
  if (recentBatting) {
    recentBatting.innerHTML = (psDisplay.recent_batting || []).map(r => {
      const opponentText = r.opponent ? ` vs. ${r.opponent}` : '';
      return `<li><span>${r.runs} (${r.balls})${opponentText}</span><span>${formatHumanDate(r.date)}</span></li>`;
    }).join('') || '<li>No recent batting data</li>';
  }
  
  const recentBowling = document.getElementById('recentBowling');
  if (recentBowling) {
    recentBowling.innerHTML = (psDisplay.recent_bowling || []).map(r => {
      const opponentText = r.opponent ? ` vs. ${r.opponent}` : '';
      return `<li><span>${r.wickets}/${r.runs} (${r.overs}ov)${opponentText}</span><span>${formatHumanDate(r.date)}</span></li>`;
    }).join('') || '<li>No recent bowling data</li>';
  }
  
  // PoM history
  const pomHistory = document.getElementById('pomHistory');
  if (pomHistory) {
    pomHistory.innerHTML = (psDisplay.pom_matches || []).map(m =>
      `<li><span>${formatHumanDate(m.date)} vs ${m.opponent || ''}</span></li>`
    ).join('') || '<li>No Man of the Match awards</li>';
  }
  
  // Ground stats
  const groundTbody = document.querySelector('#groundStats tbody');
  if (groundTbody) {
    // Clear existing table cards on mobile before updating table (prevents cached data)
    const groundTable = document.getElementById('groundStats');
    if (groundTable) {
      const groundWrapper = groundTable.closest('.table-wrapper');
      if (groundWrapper) {
        const existingCards = groundWrapper.querySelector('.table-cards');
        if (existingCards) {
          existingCards.remove();
        }
      }
    }
    
    if (psDisplay.ground_stats && Object.keys(psDisplay.ground_stats).length > 0) {
      groundTbody.innerHTML = Object.entries(psDisplay.ground_stats).map(([ground, gstat]) =>
        `<tr><td>${ground}</td><td>${gstat.innings}</td><td>${gstat.runs}</td><td>${gstat.balls}</td><td>${gstat.sr}</td><td>${gstat.avg}</td></tr>`
      ).join('');
    } else {
      groundTbody.innerHTML = '<tr><td colspan="6">No ground data available</td></tr>';
    }
    
    // Recreate cards on mobile after table update
    convertTableToCards('groundStats');
  }
  
  // Bowling ground stats
  const bowlGroundTbody = document.querySelector('#bowlGroundStats tbody');
  if (bowlGroundTbody) {
    // Clear existing table cards on mobile before updating table (prevents cached data)
    const bowlGroundTable = document.getElementById('bowlGroundStats');
    if (bowlGroundTable) {
      const bowlGroundWrapper = bowlGroundTable.closest('.table-wrapper');
      if (bowlGroundWrapper) {
        const existingCards = bowlGroundWrapper.querySelector('.table-cards');
        if (existingCards) {
          existingCards.remove();
        }
      }
    }
    
    if (psDisplay.bowl_ground_stats && Object.keys(psDisplay.bowl_ground_stats).length > 0) {
      bowlGroundTbody.innerHTML = Object.entries(psDisplay.bowl_ground_stats).map(([ground, gstat]) => {
        const overs = gstat.overs?.toFixed ? gstat.overs.toFixed(1) : fmt(gstat.overs);
        const dotPct = gstat.dot_pct !== undefined ? gstat.dot_pct.toFixed(1) : '-';
        const econ = gstat.econ !== undefined ? gstat.econ.toFixed(2) : '-';
        return `<tr><td>${ground}</td><td>${gstat.innings}</td><td>${overs}</td><td>${dotPct}</td><td>${gstat.wickets}</td><td>${econ}</td></tr>`;
      }).join('');
    } else {
      bowlGroundTbody.innerHTML = '<tr><td colspan="6">No bowling ground data available</td></tr>';
    }
    
    // Recreate cards on mobile after table update
    convertTableToCards('bowlGroundStats');
  }
  
  // Render performance charts (use filtered-derived stats when filters active)
  renderPlayerPerformanceCharts(name, psDisplay);
}

let playerSelectListener = null;

function loadPlayerData() {
  const stats = Object.keys(filteredData.stats || {}).length > 0 ? filteredData.stats : (allData.stats || {});
  const players = Object.keys(stats).sort();
  const sel = document.getElementById('playerSelect');
  
  if (!sel) {
    logError('playerSelect element not found');
    return;
  }
  
  sel.setAttribute('aria-label', 'Select player to view statistics');
  
  // Remove old event listener if exists
  if (playerSelectListener) {
    sel.removeEventListener('change', playerSelectListener);
  }
  
  // Keep the current player when filters change (loadPlayerData runs from applyFilters).
  const previousValue = sel.value;
  
  // Clear and repopulate dropdown
  sel.innerHTML = players.map(p => `<option value="${p}">${p}</option>`).join('');
  
  // Add new event listener
  playerSelectListener = function(e) {
    renderPlayer(e.target.value);
  };
  sel.addEventListener('change', playerSelectListener);
  
  if (players.length) {
    const chosen =
      previousValue && players.includes(previousValue) ? previousValue : players[0];
    sel.value = chosen;
    renderPlayer(chosen);
  }
}

/** Rows shown on the home "Recent match results" table (not the "Last 5" filter preset). */
const HOME_RECENT_RESULTS_LIMIT = 5;

// Chart instances
let battingTrendChartInstance = null;
let bowlingTrendChartInstance = null;

/** Max matches in the form strip; rolling win % and momentum use the same window. */
const FORM_MOMENTUM_WINDOW = 10;

function matchDateMs(m) {
  if (!m || !m.match_date) return null;
  const t = new Date(String(m.match_date) + 'T00:00:00').getTime();
  return Number.isNaN(t) ? null : t;
}

function isDecidedResult(r) {
  return r === 'Win' || r === 'Loss' || r === 'Draw' || r === 'Tie';
}

function sortMatchesChronologically(matches) {
  const arr = (matches || []).filter(m => m && isDecidedResult(m.result));
  arr.sort((a, b) => {
    const ta = matchDateMs(a);
    const tb = matchDateMs(b);
    if (ta != null && tb != null && ta !== tb) return ta - tb;
    if (ta == null && tb == null) return (a.match_id || 0) - (b.match_id || 0);
    if (ta == null) return 1;
    if (tb == null) return -1;
    const ida = a.match_id || 0;
    const idb = b.match_id || 0;
    if (ida !== idb) return ida - idb;
    return 0;
  });
  return arr;
}

function computeFormMomentum(matches, windowSize) {
  const sorted = sortMatchesChronologically(matches);
  const n = Math.min(windowSize, sorted.length);
  const window = n ? sorted.slice(-n) : [];
  const prior = sorted.length > n ? sorted.slice(-2 * n, -n) : [];

  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const m of window) {
    if (m.result === 'Win') wins++;
    else if (m.result === 'Loss') losses++;
    else draws++;
  }
  const total = window.length;
  const winPct = total ? Math.round((wins / total) * 1000) / 10 : 0;

  let priorWinPct = null;
  if (prior.length) {
    let pw = 0;
    for (const m of prior) {
      if (m.result === 'Win') pw++;
    }
    priorWinPct = Math.round((pw / prior.length) * 1000) / 10;
  }

  let streakLabel = '';
  if (window.length) {
    const last = window[window.length - 1];
    const r = last.result;
    let count = 0;
    for (let i = window.length - 1; i >= 0; i--) {
      if (window[i].result === r) count++;
      else break;
    }
    if (r === 'Win') streakLabel = `W${count}`;
    else if (r === 'Loss') streakLabel = `L${count}`;
    else streakLabel = `D${count}`;
  }

  let trendClass = 'form-momentum-trend--flat';
  let trendSymbol = '→';
  let trendDiffText = '';
  if (priorWinPct !== null) {
    const diff = winPct - priorWinPct;
    if (diff > 3) {
      trendClass = 'form-momentum-trend--up';
      trendSymbol = '↑';
    } else if (diff < -3) {
      trendClass = 'form-momentum-trend--down';
      trendSymbol = '↓';
    }
    const sign = diff > 0 ? '+' : '';
    trendDiffText = `${sign}${diff.toFixed(1)} pts vs prior ${prior.length}`;
  }

  return {
    window,
    priorLen: prior.length,
    wins,
    losses,
    draws,
    winPct,
    priorWinPct,
    streakLabel,
    trendClass,
    trendSymbol,
    trendDiffText,
    totalWithResult: sorted.length
  };
}

function formatFormDate(d) {
  if (!d) return '';
  try {
    const x = new Date(String(d) + 'T00:00:00');
    return x.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (e) {
    return String(d);
  }
}

function escapeFormAttr(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderFormMomentum() {
  const section = document.getElementById('formMomentumSection');
  if (!section) return;

  const results = filteredData.matchResults || [];
  const fm = computeFormMomentum(results, FORM_MOMENTUM_WINDOW);

  if (fm.window.length === 0) {
    section.innerHTML = '<p style="text-align:center; color:#64748B; padding:24px;">No match results with Win/Loss/Draw in the current filters.</p>';
    return;
  }

  const oppLabel = (m) => {
    const o = m.opponent && String(m.opponent).trim();
    return o || 'opponent';
  };

  const pills = fm.window.map((m) => {
    let label = '?';
    let cls = 'form-pill--draw';
    const forfeit = String(m.result_detail || '').trim() === 'Forfeit';
    if (m.result === 'Win') {
      label = forfeit ? 'W(F)' : 'W';
      cls = 'form-pill--win';
    } else if (m.result === 'Loss') {
      label = forfeit ? 'L(F)' : 'L';
      cls = 'form-pill--loss';
    } else if (m.result === 'Draw' || m.result === 'Tie') {
      label = m.result === 'Tie' ? 'T' : 'D';
      cls = 'form-pill--draw';
    }
    const resultPhrase =
      forfeit && (m.result === 'Win' || m.result === 'Loss')
        ? `${m.result} (forfeit)`
        : m.result;
    const title = `${resultPhrase} vs ${oppLabel(m)} — ${formatFormDate(m.match_date)}`;
    const safeTitle = escapeFormAttr(title);
    return `<span class="form-pill ${cls}" title="${safeTitle}" aria-label="${safeTitle}">${escapeFormAttr(label)}</span>`;
  }).join('');

  const record = `${fm.wins}W-${fm.losses}L${fm.draws ? `-${fm.draws}D` : ''}`;
  let metricsInner = `<span class="form-momentum-trend ${fm.trendClass}">${fm.winPct}% in last ${fm.window.length} (${record})</span>`;
  metricsInner += ` · Streak <strong>${escapeFormAttr(fm.streakLabel)}</strong>`;
  if (fm.priorWinPct !== null) {
    metricsInner += ` · Prior ${fm.priorLen}: ${fm.priorWinPct}% <span class="form-momentum-trend ${fm.trendClass}">${fm.trendSymbol} ${escapeFormAttr(fm.trendDiffText)}</span>`;
  }

  section.innerHTML = `
    <div class="form-momentum-metrics">${metricsInner}</div>
    <div class="form-strip">${pills}</div>
  `;
}

/** Short date for chart axis (e.g. "4 Apr") — keeps x labels readable. */
function formatShortChartDate(dateString) {
  if (!dateString || dateString === '-') return '';
  try {
    const date = new Date(dateString + 'T00:00:00');
    if (isNaN(date.getTime())) return String(dateString).slice(5, 10);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${date.getDate()} ${monthNames[date.getMonth()]}`;
  } catch (e) {
    return '';
  }
}

function truncatePerformanceLabel(str, maxLen) {
  const s = (str && String(str).trim()) || '';
  if (!s || s === '-') return '';
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(1, maxLen - 1)) + '…';
}

/** One line per inning: opponent (truncated) · short date */
function performanceInningsLabel(opponent, dateString) {
  const opp = truncatePerformanceLabel(opponent, 16);
  const d = formatShortChartDate(dateString);
  if (opp && d) return `${opp} · ${d}`;
  if (opp) return opp;
  if (d) return d;
  return '—';
}

// Player Performance Trends Charts (discrete bar charts per innings / spell)
function renderPlayerPerformanceCharts(playerName, statsOverride) {
  const stats = Object.keys(filteredData.stats || {}).length > 0 ? filteredData.stats : (allData.stats || {});
  const ps =
    statsOverride !== undefined && statsOverride !== null
      ? statsOverride
      : stats[playerName];
  if (!ps) {
    // Clear charts if no player data
    if (battingTrendChartInstance) {
      battingTrendChartInstance.destroy();
      battingTrendChartInstance = null;
    }
    if (bowlingTrendChartInstance) {
      bowlingTrendChartInstance.destroy();
      bowlingTrendChartInstance = null;
    }
    return;
  }
  
  // Helper function to ensure canvas exists
  // Always removes and recreates canvas DOM element to prevent Chrome Mobile caching
  // This is critical for mobile browsers where canvas elements are cached at browser/GPU level
  function ensureCanvas(canvasId, ariaLabel, containerSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) return null;
    
    // Always remove existing canvas from DOM if it exists
    // This prevents Chrome Mobile from caching the canvas element itself
    const existingCanvas = document.getElementById(canvasId);
    if (existingCanvas) {
      existingCanvas.remove();
    }
    
    // Remove any existing no-data message
    const existingMsg = container.querySelector('.no-data-message');
    if (existingMsg) existingMsg.remove();
    
    // Create a completely fresh canvas element
    const canvas = document.createElement('canvas');
    canvas.id = canvasId;
    canvas.setAttribute('aria-label', ariaLabel);
    container.appendChild(canvas);
    
    return canvas;
  }
  
  // Helper function to show/hide chart or no-data message
  function renderChartOrMessage(canvas, hasData, chartInstanceVar, createChartFn, noDataMessage) {
    if (!canvas) return;
    
    // Remove any existing no-data message
    const noDataMsg = canvas.parentElement.querySelector('.no-data-message');
    if (noDataMsg) noDataMsg.remove();
    
    // Destroy existing chart instance and clear canvas context
    if (chartInstanceVar) {
      try {
        chartInstanceVar.destroy();
      } catch (e) {
        // Chart may already be destroyed, ignore error
        devWarn('Error destroying chart:', e);
      }
    }
    
    // Explicitly clear canvas context to prevent stale data on mobile browsers
    // This is critical for mobile where canvas caching is more aggressive
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Use canvas internal dimensions if set (by previous Chart.js instance),
      // otherwise use client dimensions as fallback
      const width = canvas.width || canvas.clientWidth || 800;
      const height = canvas.height || canvas.clientHeight || 400;
      ctx.clearRect(0, 0, width, height);
    }
    
    if (hasData) {
      // Show canvas and create chart
      canvas.style.display = 'block';
      createChartFn();
    } else {
      // Hide canvas and show no-data message
      canvas.style.display = 'none';
      const msg = document.createElement('p');
      msg.className = 'no-data-message';
      msg.style.cssText = 'text-align:center; color:#64748B; padding:20px; margin:0;';
      msg.textContent = noDataMessage;
      canvas.parentElement.appendChild(msg);
    }
  }
  
  // Batting Trend Chart
  let battingCanvas = ensureCanvas('battingTrendChart', 'Batting runs in last five innings', '.performance-charts-grid > .chart-container:first-child');
  if (battingCanvas) {
    const recentBatting = ps.recent_batting || [];
    const battingChrono = [...recentBatting].reverse();
    const battingLabels = battingChrono.map(r => performanceInningsLabel(r.opponent, r.date));
    const battingRuns = battingChrono.map(r => r.runs || 0);
    
    // For mobile compatibility, always destroy and recreate chart
    // Update() method doesn't work reliably on mobile browsers
    if (battingTrendChartInstance) {
      try {
        battingTrendChartInstance.destroy();
      } catch (e) {
        devWarn('Error destroying batting chart:', e);
      }
      battingTrendChartInstance = null;
    }
    
    if (recentBatting.length > 0) {
      // Create new chart with fresh data
      // Canvas is already a fresh DOM element (recreated by ensureCanvas), so no need for clearing
      battingCanvas.style.display = 'block';
      // Remove any no-data message
      const noDataMsg = battingCanvas.parentElement.querySelector('.no-data-message');
      if (noDataMsg) noDataMsg.remove();
      
      const battingCtx = battingCanvas.getContext('2d');
      battingTrendChartInstance = new Chart(battingCtx, {
        type: 'bar',
        data: {
          labels: battingLabels,
          datasets: [{
            label: 'Runs',
            data: battingRuns,
            borderColor: 'rgb(5, 150, 105)',
            backgroundColor: 'rgba(16, 185, 129, 0.75)',
            borderWidth: 1,
            borderRadius: 6,
            maxBarThickness: 56
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false
            },
            title: {
              display: true,
              text: 'Recent batting (last 5 innings)',
              font: {
                size: 14,
                weight: 'bold'
              }
            },
            tooltip: {
              callbacks: {
                title(items) {
                  const i = items[0].dataIndex;
                  const r = battingChrono[i];
                  const opp = (r && r.opponent && String(r.opponent).trim()) || '—';
                  return `${formatHumanDate(r.date)} · ${opp}`;
                },
                label(ctx) {
                  const r = battingChrono[ctx.dataIndex];
                  const runs = r.runs || 0;
                  const balls = r.balls || 0;
                  const sr = balls > 0 ? ((runs / balls) * 100).toFixed(1) : '—';
                  return [`Runs: ${runs}`, `Balls: ${balls}`, `SR: ${sr}`];
                }
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { precision: 0 },
              title: {
                display: true,
                text: 'Runs'
              }
            },
            x: {
              title: {
                display: true,
                text: 'Innings (oldest → newest)'
              },
              ticks: {
                maxRotation: 45,
                minRotation: 0,
                autoSkip: false
              }
            }
          }
        }
      });
    } else {
      // No data - destroy chart if it exists and show message
      if (battingTrendChartInstance) {
        try {
          battingTrendChartInstance.destroy();
          battingTrendChartInstance = null;
        } catch (e) {
          devWarn('Error destroying batting chart:', e);
        }
      }
      battingCanvas.style.display = 'none';
      const noDataMsg = battingCanvas.parentElement.querySelector('.no-data-message');
      if (!noDataMsg) {
        const msg = document.createElement('p');
        msg.className = 'no-data-message';
        msg.style.cssText = 'text-align:center; color:#64748B; padding:20px; margin:0;';
        msg.textContent = 'No batting data available.';
        battingCanvas.parentElement.appendChild(msg);
      }
    }
  }
  
  // Bowling Trend Chart
  let bowlingCanvas = ensureCanvas('bowlingTrendChart', 'Bowling wickets in last five spells', '.performance-charts-grid > .chart-container:last-child');
  if (bowlingCanvas) {
    const recentBowling = ps.recent_bowling || [];
    const bowlingChrono = [...recentBowling].reverse();
    const bowlingLabels = bowlingChrono.map(r => performanceInningsLabel(r.opponent, r.date));
    const bowlingWickets = bowlingChrono.map(r => r.wickets || 0);
    
    // For mobile compatibility, always destroy and recreate chart
    // Update() method doesn't work reliably on mobile browsers
    if (bowlingTrendChartInstance) {
      try {
        bowlingTrendChartInstance.destroy();
      } catch (e) {
        devWarn('Error destroying bowling chart:', e);
      }
      bowlingTrendChartInstance = null;
    }
    
    if (recentBowling.length > 0) {
      // Create new chart with fresh data
      // Canvas is already a fresh DOM element (recreated by ensureCanvas), so no need for clearing
      bowlingCanvas.style.display = 'block';
      // Remove any no-data message
      const noDataMsg = bowlingCanvas.parentElement.querySelector('.no-data-message');
      if (noDataMsg) noDataMsg.remove();
      
      const bowlingCtx = bowlingCanvas.getContext('2d');
      bowlingTrendChartInstance = new Chart(bowlingCtx, {
        type: 'bar',
        data: {
          labels: bowlingLabels,
          datasets: [{
            label: 'Wickets',
            data: bowlingWickets,
            borderColor: 'rgb(185, 28, 28)',
            backgroundColor: 'rgba(239, 68, 68, 0.75)',
            borderWidth: 1,
            borderRadius: 6,
            maxBarThickness: 56
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false
            },
            title: {
              display: true,
              text: 'Recent bowling (last 5 spells)',
              font: {
                size: 14,
                weight: 'bold'
              }
            },
            tooltip: {
              callbacks: {
                title(items) {
                  const i = items[0].dataIndex;
                  const r = bowlingChrono[i];
                  const opp = (r && r.opponent && String(r.opponent).trim()) || '—';
                  return `${formatHumanDate(r.date)} · ${opp}`;
                },
                label(ctx) {
                  const r = bowlingChrono[ctx.dataIndex];
                  const wk = r.wickets || 0;
                  const runsConc = r.runs != null ? r.runs : '—';
                  const overs = r.overs != null ? r.overs : '—';
                  return [`Wickets: ${wk}`, `Runs conceded: ${runsConc}`, `Overs: ${overs}`];
                }
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                stepSize: 1,
                precision: 0
              },
              title: {
                display: true,
                text: 'Wickets'
              }
            },
            x: {
              title: {
                display: true,
                text: 'Spells (oldest → newest)'
              },
              ticks: {
                maxRotation: 45,
                minRotation: 0,
                autoSkip: false
              }
            }
          }
        }
      });
    } else {
      // No data - destroy chart if it exists and show message
      if (bowlingTrendChartInstance) {
        try {
          bowlingTrendChartInstance.destroy();
          bowlingTrendChartInstance = null;
        } catch (e) {
          devWarn('Error destroying bowling chart:', e);
        }
      }
      bowlingCanvas.style.display = 'none';
      const noDataMsg = bowlingCanvas.parentElement.querySelector('.no-data-message');
      if (!noDataMsg) {
        const msg = document.createElement('p');
        msg.className = 'no-data-message';
        msg.style.cssText = 'text-align:center; color:#64748B; padding:20px; margin:0;';
        msg.textContent = 'No bowling data available.';
        bowlingCanvas.parentElement.appendChild(msg);
      }
    }
  }
}

// Convert tables to cards on mobile
function convertTableToCards(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return;
  
  const wrapper = table.closest('.table-wrapper');
  if (!wrapper) return;
  
  // Check if we're on mobile
  const isMobile = window.innerWidth < 769;
  
  // Remove existing cards
  const existingCards = wrapper.querySelector('.table-cards');
  if (existingCards) {
    existingCards.remove();
  }
  
  if (!isMobile) {
    return; // Don't create cards on desktop
  }
  
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  if (!thead || !tbody) return;
  
  const headers = Array.from(thead.querySelectorAll('th')).map(th => th.textContent.trim());
  const rows = Array.from(tbody.querySelectorAll('tr'));
  
  if (rows.length === 0) return;
  
  const cardsContainer = document.createElement('div');
  cardsContainer.className = 'table-cards';
  
  rows.forEach(row => {
    const cells = Array.from(row.querySelectorAll('td'));
    if (cells.length === 0) return;
    
    const card = document.createElement('div');
    card.className = 'table-card';
    
    headers.forEach((header, index) => {
      if (cells[index]) {
        const cardRow = document.createElement('div');
        cardRow.className = 'table-card-row';
        
        const label = document.createElement('div');
        label.className = 'table-card-label';
        label.textContent = header;
        
        const value = document.createElement('div');
        value.className = 'table-card-value';
        value.textContent = cells[index].textContent.trim();
        
        cardRow.appendChild(label);
        cardRow.appendChild(value);
        card.appendChild(cardRow);
      }
    });
    
    cardsContainer.appendChild(card);
  });
  
  wrapper.appendChild(cardsContainer);
}

// Convert all tables to cards on mobile
function convertAllTablesToCards() {
  const tableIds = ['last5Results', 'winByGround', 'winByToss', 'winByMatchType', 'positionStats', 'groundStats', 'bowlGroundStats'];
  tableIds.forEach(id => convertTableToCards(id));
}

// Call on window resize and after data loads
let resizeTimeout;
window.addEventListener('resize', function() {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(convertAllTablesToCards, 250);
});

