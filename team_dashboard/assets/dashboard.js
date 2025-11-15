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
      fetchJSON('assets/player_photos.json', 'player_photos'),
      fetchJSON('assets/match_results.json', 'match_results'),
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
      // Filter by series if series is specified and series filter is set
      // Use original series names for matching against match data
      if (selectedOriginalSeries.size > 0 && m.series && !selectedOriginalSeries.has(m.series)) return false;
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

// Helper function to recalculate stats from filtered match-level data
function calculateFilteredStats(playerStats, validMatchKeys) {
  if (!validMatchKeys || validMatchKeys.size === 0) {
    return null; // No filters active, use all-time stats
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
    noballs: 0
  };
  
  // Filter and aggregate batting stats from recent_batting
  if (playerStats.recent_batting && Array.isArray(playerStats.recent_batting)) {
    const filteredBatting = playerStats.recent_batting.filter(match => {
      if (!match.date || !match.opponent) return false;
      const key = `${match.date}|${match.opponent}`;
      return validMatchKeys.has(key);
    });
    
    filteredBatting.forEach(match => {
      filteredStats.runs += match.runs || 0;
      filteredStats.balls += match.balls || 0;
    });
    
    // Calculate strike rate (rounded to 1 decimal place)
    if (filteredStats.balls > 0) {
      filteredStats.sr = Math.round((filteredStats.runs / filteredStats.balls) * 1000) / 10;
    } else {
      filteredStats.sr = 0;
    }
  }
  
  // Filter and aggregate bowling stats from recent_bowling
  if (playerStats.recent_bowling && Array.isArray(playerStats.recent_bowling)) {
    const filteredBowling = playerStats.recent_bowling.filter(match => {
      if (!match.date || !match.opponent) return false;
      const key = `${match.date}|${match.opponent}`;
      return validMatchKeys.has(key);
    });
    
    let totalBalls = 0;
    filteredBowling.forEach(match => {
      filteredStats.wickets += match.wickets || 0;
      filteredStats.runs_conceded += match.runs || 0;
      // Convert overs to balls (overs format: X.Y where Y is balls in that over, e.g., 2.3 = 2 overs 3 balls = 15 balls)
      const overs = match.overs || 0;
      const wholeOvers = Math.floor(overs);
      const ballsInOver = Math.round((overs % 1) * 10);
      const balls = wholeOvers * 6 + ballsInOver;
      totalBalls += balls;
    });
    
    // Store totalBalls for use in dot percentage calculation
    filteredStats._totalBalls = totalBalls;
    
    // Convert total balls back to overs (e.g., 15 balls = 2.3 overs)
    filteredStats.overs = Math.floor(totalBalls / 6) + (totalBalls % 6) / 10;
    
    // Calculate economy
    if (totalBalls > 0) {
      filteredStats.econ = (filteredStats.runs_conceded / totalBalls) * 6;
    } else {
      filteredStats.econ = 0;
    }
    
    // Calculate bowling strike rate
    if (filteredStats.wickets > 0) {
      filteredStats.bowl_sr = totalBalls / filteredStats.wickets;
    } else {
      filteredStats.bowl_sr = 0;
    }
  }
  
  // For metrics not available in match-level data (4s, 6s, dot_balls), estimate proportionally
  // Calculate proportion of filtered runs for batting (4s and 6s)
  if (filteredStats.runs > 0 && playerStats.runs > 0 && playerStats['4s'] !== undefined) {
    const runsRatio = filteredStats.runs / playerStats.runs;
    filteredStats['4s'] = Math.round((playerStats['4s'] || 0) * runsRatio);
    filteredStats['6s'] = Math.round((playerStats['6s'] || 0) * runsRatio);
  } else if (filteredStats.balls > 0 && playerStats.balls > 0 && playerStats['4s'] !== undefined) {
    const ballsRatio = filteredStats.balls / playerStats.balls;
    filteredStats['4s'] = Math.round((playerStats['4s'] || 0) * ballsRatio);
    filteredStats['6s'] = Math.round((playerStats['6s'] || 0) * ballsRatio);
  }
  
  // Calculate proportion of filtered balls for bowling dot_balls
  const totalBalls = filteredStats._totalBalls || 0;
  if (totalBalls > 0 && playerStats.bowl_total_balls > 0 && playerStats.dot_balls !== undefined) {
    const ballsRatio = totalBalls / playerStats.bowl_total_balls;
    filteredStats.dot_balls = Math.round((playerStats.dot_balls || 0) * ballsRatio);
    filteredStats.dot_balls = Math.min(filteredStats.dot_balls, totalBalls);
    
    if (totalBalls > 0) {
      filteredStats.bowl_dot_pct = Math.round((filteredStats.dot_balls / totalBalls) * 1000) / 10;
    } else {
      filteredStats.bowl_dot_pct = 0;
    }
  } else if (totalBalls > 0 && playerStats.overs > 0 && playerStats.dot_balls !== undefined) {
    const oversRatio = filteredStats.overs / playerStats.overs;
    filteredStats.dot_balls = Math.round((playerStats.dot_balls || 0) * oversRatio);
    filteredStats.dot_balls = Math.min(filteredStats.dot_balls, totalBalls);
    
    if (totalBalls > 0) {
      filteredStats.bowl_dot_pct = Math.round((filteredStats.dot_balls / totalBalls) * 1000) / 10;
    } else {
      filteredStats.bowl_dot_pct = 0;
    }
  }
  
  // Clean up temporary field
  delete filteredStats._totalBalls;
  
  return filteredStats;
}

function renderHome() {
  try {
    // Last 5 results
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
      tbody.innerHTML = sortedResults.slice(0, 5).map(m => {
        const normalizedSeries = m.series ? normalizeSeriesName(m.series) : '-';
        return `<tr><td>${formatHumanDate(m.match_date)}</td><td>${m.opponent || '-'}</td><td>${m.result || '-'}</td><td>${formatMatchType(m.match_type)}</td><td>${m.ground || '-'}</td><td>${normalizedSeries}</td></tr>`;
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

function renderTeamStats() {
  try {
    const ta = filteredData.teamAnalytics || allData.teamAnalytics || {};
    const winPctElem = document.getElementById('winPct');
    if (winPctElem) {
      winPctElem.textContent = ta.overall_win_pct ? `${ta.overall_win_pct}%` : '-';
    }
    
    // Render win rate chart
    renderWinRateChart();
    
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
  
  function fmt(v) { return (v === null || v === undefined) ? '-' : v; }
  
  const playerCard = document.getElementById('playerCard');
  if (playerCard) {
    playerCard.style.display = 'flex';
    playerCard.setAttribute('aria-label', `Statistics for ${name}`);
  }
  
  document.getElementById('pi_name').textContent = name;
  document.getElementById('pi_runs').textContent = fmt(ps.runs);
  document.getElementById('pi_sr').textContent = fmt(ps.sr);
  document.getElementById('pi_avg').textContent = fmt(ps.avg);
  
  let batDotPct = null;
  if (ps.bat_dot_pct !== undefined) {
    batDotPct = ps.bat_dot_pct;
  } else if (ps.bat_tracked_balls !== undefined && ps.bat_tracked_balls > 0) {
    batDotPct = ((ps.bat_dot_balls || 0) / ps.bat_tracked_balls) * 100;
  }
  document.getElementById('pi_bat_dot').textContent = batDotPct !== null && batDotPct !== undefined ? fmt(batDotPct.toFixed(1)) : '-';
  
  document.getElementById('pi_4s').textContent = fmt(ps['4s']);
  document.getElementById('pi_6s').textContent = fmt(ps['6s']);
  document.getElementById('pi_wk').textContent = fmt(ps.wickets);
  document.getElementById('pi_overs').textContent = fmt(ps.overs?.toFixed ? ps.overs.toFixed(1) : fmt(ps.overs));
  document.getElementById('pi_econ').textContent = fmt(ps.econ);
  
  const bowlDotPct = ps.bowl_dot_pct !== undefined ? ps.bowl_dot_pct :
                     (ps.overs > 0 && ps.dot_balls !== undefined ? ((ps.dot_balls || 0) / ((ps.overs || 0) * 6) * 100) : null);
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
    if (ps.position_stats) {
      posTbody.innerHTML = Object.entries(ps.position_stats).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).map(([pos, pstat]) =>
        `<tr><td>${pos}</td><td>${pstat.innings || 0}</td><td>${pstat.runs}</td><td>${pstat.balls}</td><td>${pstat.sr}</td><td>${pstat.avg}</td><td>${pstat.outs}</td></tr>`
      ).join('');
    } else {
      posTbody.innerHTML = '<tr><td colspan="7">No position data</td></tr>';
    }
  }
  
  // Dismissal stats
  const dismissalStatsElem = document.getElementById('dismissalStats');
  if (dismissalStatsElem) {
    if (ps.dismissal_stats && Object.keys(ps.dismissal_stats).length > 0) {
      const dismissalEntries = Object.entries(ps.dismissal_stats)
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
    recentBatting.innerHTML = (ps.recent_batting || []).map(r => {
      const opponentText = r.opponent ? ` vs. ${r.opponent}` : '';
      return `<li><span>${r.runs} (${r.balls})${opponentText}</span><span>${formatHumanDate(r.date)}</span></li>`;
    }).join('') || '<li>No recent batting data</li>';
  }
  
  const recentBowling = document.getElementById('recentBowling');
  if (recentBowling) {
    recentBowling.innerHTML = (ps.recent_bowling || []).map(r => {
      const opponentText = r.opponent ? ` vs. ${r.opponent}` : '';
      return `<li><span>${r.wickets}/${r.runs} (${r.overs}ov)${opponentText}</span><span>${formatHumanDate(r.date)}</span></li>`;
    }).join('') || '<li>No recent bowling data</li>';
  }
  
  // PoM history
  const pomHistory = document.getElementById('pomHistory');
  if (pomHistory) {
    pomHistory.innerHTML = (ps.pom_matches || []).map(m =>
      `<li><span>${formatHumanDate(m.date)} vs ${m.opponent || ''}</span></li>`
    ).join('') || '<li>No Man of the Match awards</li>';
  }
  
  // Ground stats
  const groundTbody = document.querySelector('#groundStats tbody');
  if (groundTbody) {
    if (ps.ground_stats) {
      groundTbody.innerHTML = Object.entries(ps.ground_stats).map(([ground, gstat]) =>
        `<tr><td>${ground}</td><td>${gstat.innings}</td><td>${gstat.runs}</td><td>${gstat.balls}</td><td>${gstat.sr}</td><td>${gstat.avg}</td></tr>`
      ).join('');
    } else {
      groundTbody.innerHTML = '<tr><td colspan="6">No ground data available</td></tr>';
    }
  }
  
  // Bowling ground stats
  const bowlGroundTbody = document.querySelector('#bowlGroundStats tbody');
  if (bowlGroundTbody) {
    if (ps.bowl_ground_stats) {
      bowlGroundTbody.innerHTML = Object.entries(ps.bowl_ground_stats).map(([ground, gstat]) => {
        const overs = gstat.overs?.toFixed ? gstat.overs.toFixed(1) : fmt(gstat.overs);
        const dotPct = gstat.dot_pct !== undefined ? gstat.dot_pct.toFixed(1) : '-';
        const econ = gstat.econ !== undefined ? gstat.econ.toFixed(2) : '-';
        return `<tr><td>${ground}</td><td>${gstat.innings}</td><td>${overs}</td><td>${dotPct}</td><td>${gstat.wickets}</td><td>${econ}</td></tr>`;
      }).join('');
    } else {
      bowlGroundTbody.innerHTML = '<tr><td colspan="6">No bowling ground data available</td></tr>';
    }
  }
  
  // Render performance charts
  renderPlayerPerformanceCharts(name);
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
  
  // Clear and repopulate dropdown
  sel.innerHTML = players.map(p => `<option value="${p}">${p}</option>`).join('');
  
  // Add new event listener
  playerSelectListener = function(e) {
    renderPlayer(e.target.value);
  };
  sel.addEventListener('change', playerSelectListener);
  
  if (players.length) {
    sel.value = players[0];
    renderPlayer(players[0]);
  }
}

// Chart instances
let winRateChartInstance = null;
let battingTrendChartInstance = null;
let bowlingTrendChartInstance = null;

// Win Rate Over Time Chart
function renderWinRateChart() {
  const canvas = document.getElementById('winRateChart');
  if (!canvas) return;
  
  const results = filteredData.matchResults || [];
  if (results.length === 0) {
    if (winRateChartInstance) {
      winRateChartInstance.destroy();
      winRateChartInstance = null;
    }
    canvas.parentElement.innerHTML = '<p style="text-align:center; color:#64748B; padding:40px;">No match data available for chart.</p>';
    return;
  }
  
  // Group matches by month
  const matchesByMonth = {};
  results.forEach(match => {
    if (!match.match_date) return;
    const date = new Date(match.match_date + 'T00:00:00');
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!matchesByMonth[monthKey]) {
      matchesByMonth[monthKey] = { wins: 0, losses: 0, draws: 0, total: 0 };
    }
    matchesByMonth[monthKey].total++;
    if (match.result === 'Win') matchesByMonth[monthKey].wins++;
    else if (match.result === 'Loss') matchesByMonth[monthKey].losses++;
    else if (match.result === 'Draw') matchesByMonth[monthKey].draws++;
  });
  
  // Sort by date
  const sortedMonths = Object.keys(matchesByMonth).sort();
  const labels = sortedMonths.map(month => {
    const [year, monthNum] = month.split('-');
    const date = new Date(parseInt(year), parseInt(monthNum) - 1);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  });
  
  const winRates = sortedMonths.map(month => {
    const data = matchesByMonth[month];
    return data.total > 0 ? ((data.wins / data.total) * 100).toFixed(1) : 0;
  });
  
  const ctx = canvas.getContext('2d');
  
  // Destroy existing chart if it exists
  if (winRateChartInstance) {
    winRateChartInstance.destroy();
  }
  
  winRateChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Win Rate %',
        data: winRates,
        borderColor: 'rgb(139, 92, 246)',
        backgroundColor: 'rgba(139, 92, 246, 0.1)',
        tension: 0.4,
        fill: true,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: 'rgb(139, 92, 246)',
        pointBorderColor: '#fff',
        pointBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top'
        },
        tooltip: {
          mode: 'index',
          intersect: false
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: {
            callback: function(value) {
              return value + '%';
            }
          },
          title: {
            display: true,
            text: 'Win Rate (%)'
          }
        },
        x: {
          title: {
            display: true,
            text: 'Month'
          }
        }
      },
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false
      }
    }
  });
}

// Player Performance Trends Charts
function renderPlayerPerformanceCharts(playerName) {
  const stats = Object.keys(filteredData.stats || {}).length > 0 ? filteredData.stats : (allData.stats || {});
  const ps = stats[playerName];
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
  
  // Helper function to ensure canvas exists (recreate if destroyed)
  function ensureCanvas(canvasId, ariaLabel, containerSelector) {
    let canvas = document.getElementById(canvasId);
    if (!canvas) {
      const container = document.querySelector(containerSelector);
      if (container) {
        // Remove any existing no-data message
        const existingMsg = container.querySelector('.no-data-message');
        if (existingMsg) existingMsg.remove();
        
        // Recreate the canvas element
        canvas = document.createElement('canvas');
        canvas.id = canvasId;
        canvas.setAttribute('aria-label', ariaLabel);
        container.appendChild(canvas);
      }
    }
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
  let battingCanvas = ensureCanvas('battingTrendChart', 'Batting performance trend over time', '.performance-charts-grid > .chart-container:first-child');
  if (battingCanvas) {
    // Destroy and null out existing chart instance before rendering new one
    // This prevents stale data from persisting, especially on mobile browsers
    if (battingTrendChartInstance) {
      try {
        battingTrendChartInstance.destroy();
      } catch (e) {
        devWarn('Error destroying batting chart:', e);
      }
      battingTrendChartInstance = null;
    }
    
    const recentBatting = ps.recent_batting || [];
    const battingLabels = recentBatting.map(r => formatHumanDate(r.date)).reverse();
    const battingRuns = recentBatting.map(r => r.runs || 0).reverse();
    
    renderChartOrMessage(
      battingCanvas,
      recentBatting.length > 0,
      null, // Chart instance already destroyed above
      () => {
        // Clear canvas context again before creating new chart (defense in depth for mobile)
        const battingCtx = battingCanvas.getContext('2d');
        if (battingCtx) {
          // Use canvas internal dimensions if set, otherwise use client dimensions as fallback
          const width = battingCanvas.width || battingCanvas.clientWidth || 800;
          const height = battingCanvas.height || battingCanvas.clientHeight || 400;
          battingCtx.clearRect(0, 0, width, height);
        }
        
        battingTrendChartInstance = new Chart(battingCtx, {
          type: 'line',
          data: {
            labels: battingLabels,
            datasets: [{
              label: 'Runs Scored',
              data: battingRuns,
              borderColor: 'rgb(16, 185, 129)',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              tension: 0.4,
              fill: true,
              pointRadius: 4,
              pointHoverRadius: 6,
              pointBackgroundColor: 'rgb(16, 185, 129)',
              pointBorderColor: '#fff',
              pointBorderWidth: 2
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                display: true,
                position: 'top'
              },
              title: {
                display: true,
                text: 'Batting Performance',
                font: {
                  size: 14,
                  weight: 'bold'
                }
              }
            },
            scales: {
              y: {
                beginAtZero: true,
                title: {
                  display: true,
                  text: 'Runs'
                }
              },
              x: {
                title: {
                  display: true,
                  text: 'Date'
                }
              }
            }
          }
        });
      },
      'No batting data available.'
    );
  }
  
  // Bowling Trend Chart
  let bowlingCanvas = ensureCanvas('bowlingTrendChart', 'Bowling performance trend over time', '.performance-charts-grid > .chart-container:last-child');
  if (bowlingCanvas) {
    // Destroy and null out existing chart instance before rendering new one
    // This prevents stale data from persisting, especially on mobile browsers
    if (bowlingTrendChartInstance) {
      try {
        bowlingTrendChartInstance.destroy();
      } catch (e) {
        devWarn('Error destroying bowling chart:', e);
      }
      bowlingTrendChartInstance = null;
    }
    
    const recentBowling = ps.recent_bowling || [];
    const bowlingLabels = recentBowling.map(r => formatHumanDate(r.date)).reverse();
    const bowlingWickets = recentBowling.map(r => r.wickets || 0).reverse();
    
    renderChartOrMessage(
      bowlingCanvas,
      recentBowling.length > 0,
      null, // Chart instance already destroyed above
      () => {
        // Clear canvas context again before creating new chart (defense in depth for mobile)
        const bowlingCtx = bowlingCanvas.getContext('2d');
        if (bowlingCtx) {
          // Use canvas internal dimensions if set, otherwise use client dimensions as fallback
          const width = bowlingCanvas.width || bowlingCanvas.clientWidth || 800;
          const height = bowlingCanvas.height || bowlingCanvas.clientHeight || 400;
          bowlingCtx.clearRect(0, 0, width, height);
        }
        
        bowlingTrendChartInstance = new Chart(bowlingCtx, {
          type: 'line',
          data: {
            labels: bowlingLabels,
            datasets: [{
              label: 'Wickets Taken',
              data: bowlingWickets,
              borderColor: 'rgb(239, 68, 68)',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              tension: 0.4,
              fill: true,
              pointRadius: 4,
              pointHoverRadius: 6,
              pointBackgroundColor: 'rgb(239, 68, 68)',
              pointBorderColor: '#fff',
              pointBorderWidth: 2
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                display: true,
                position: 'top'
              },
              title: {
                display: true,
                text: 'Bowling Performance',
                font: {
                  size: 14,
                  weight: 'bold'
                }
              }
            },
            scales: {
              y: {
                beginAtZero: true,
                ticks: {
                  stepSize: 1
                },
                title: {
                  display: true,
                  text: 'Wickets'
                }
              },
              x: {
                title: {
                  display: true,
                  text: 'Date'
                }
              }
            }
          }
        });
      },
      'No bowling data available.'
    );
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

