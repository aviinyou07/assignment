/**
 * Realtime Notification System
 * Shared JavaScript for all role headers (Admin, Writer, BDE)
 */

// Global socket instance
let notificationSocket = null;
let unreadCount = 0;

/**
 * Initialize Socket.IO connection
 */
function initRealtimeNotifications() {
  // Get JWT token from meta tag or cookie
  const token = document.querySelector('meta[name="auth-token"]')?.content ||
                getCookie('token') ||
                localStorage.getItem('authToken');

  console.log('Initializing real-time notifications...');
  console.log('Auth token found:', !!token);

  // Load notifications immediately via API (doesn't require WebSocket)
  loadNotifications();
  loadUnreadCount();

  if (!token) {
    console.warn('No auth token found for WebSocket connection');
    return;
  }

  // Load Socket.IO if not already loaded
  if (typeof io === 'undefined') {
    console.log('Loading Socket.IO library...');
    const script = document.createElement('script');
    script.src = '/socket.io/socket.io.js';
    script.onload = () => {
      console.log('Socket.IO library loaded successfully');
      connectSocket(token);
    };
    script.onerror = () => {
      console.error('Failed to load Socket.IO library');
    };
    document.head.appendChild(script);
  } else {
    console.log('Socket.IO library already loaded, connecting...');
    connectSocket(token);
  }
}

/**
 * Get cookie value by name
 */
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return null;
}

/**
 * Connect to Socket.IO server
 */
function connectSocket(token) {
  try {
    console.log('Attempting to connect to Socket.IO server with token...');
    
    notificationSocket = io({
      auth: {
        token: 'Bearer ' + token
      },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      transports: ['websocket', 'polling']
    });

    // Connection events
    notificationSocket.on('connect', () => {
      console.log('✓ Connected to real-time notifications');
      console.log('Socket ID:', notificationSocket.id);
      updateConnectionStatus('online');
    });

    notificationSocket.on('disconnect', (reason) => {
      console.warn('Disconnected from real-time notifications:', reason);
      updateConnectionStatus('offline');
    });

    notificationSocket.on('error', (error) => {
      console.error('Socket error:', error);
    });

    notificationSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
    });

    // Real-time notification events
    notificationSocket.on('notification:new', (notification) => {
      console.log('✓ New notification received:', notification);
      addNotificationToDOM(notification);
      incrementUnreadCount();
      updateNotificationBadge();
      
      // Show toast for all notifications (different style based on type)
      showNotificationToast(notification.type || 'info', notification.title, notification.message, notification.link_url);
    });

    // Chat events (if on order/query page)
    notificationSocket.on('chat:new_message', (data) => {
      if (typeof handleChatMessage === 'function') {
        handleChatMessage(data);
      }
    });

    notificationSocket.on('chat:system_message', (data) => {
      if (typeof handleChatSystemMessage === 'function') {
        handleChatSystemMessage(data);
      }
    });

    notificationSocket.on('chat:restricted', (data) => {
      if (typeof handleChatRestricted === 'function') {
        handleChatRestricted(data);
      }
    });

    notificationSocket.on('chat:closed', (data) => {
      if (typeof handleChatClosed === 'function') {
        handleChatClosed(data);
      }
    });

    // Subscribe to context if on order/query page
    const contextCode = getContextCodeFromURL();
    if (contextCode) {
      notificationSocket.emit('subscribe:context', { context_code: contextCode });
    }
    
  } catch (error) {
    console.error('Error connecting to socket:', error);
  }
}

/**
 * Load notifications from API
 */
async function loadNotifications() {
  try {
    const response = await fetch('/notifications?page=0&limit=20', {
      credentials: 'include'
    });

    if (response.ok) {
      const data = await response.json();
      // Debug: log types returned so panel discrepancies can be diagnosed
      try { console.debug('[Notifications API] fetched', (data.notifications || []).map(n => ({ id: n.notification_id || n.id, type: n.type }))); } catch(e) {}

      if (data.success) {
        // Normalize notification objects to ensure consistent fields across endpoints
        const normalized = (data.notifications || []).map(n => ({
          notification_id: n.notification_id || n.id || n.notificationId || null,
          type: (n.type || 'info').toString().toLowerCase(),
          title: n.title || n.subject || '',
          message: n.message || n.body || '',
          link_url: n.link_url || n.link || n.url || '',
          is_read: n.is_read === 1 || n.is_read === true,
          created_at: n.created_at || n.createdAt || new Date().toISOString()
        }));

        renderNotifications(normalized);
      }
    }
  } catch (error) {
    console.error('Error loading notifications:', error);
  }
}

/**
 * Load unread count
 */
async function loadUnreadCount() {
  try {
    const response = await fetch('/notifications/unread-count', {
      credentials: 'include'
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        unreadCount = data.unread || 0;
        updateNotificationBadge();
      }
    }
  } catch (error) {
    console.error('Error loading unread count:', error);
  }
}

/**
 * Render notifications in the DOM
 */
function renderNotifications(notifications) {
  const container = document.getElementById('notif-list');
  if (!container) return;

  if (!notifications || notifications.length === 0) {
    container.innerHTML = `
      <div class="p-6 text-center">
        <i class="fi fi-rr-bell-slash text-3xl text-slate-300 mb-2 block"></i>
        <p class="text-sm text-slate-400">No notifications yet</p>
      </div>
    `;
    return;
  }

  container.innerHTML = notifications.map(notif => createNotificationHTML(notif)).join('');
}

/**
 * Create notification HTML element
 */
function createNotificationHTML(notification) {
  const typeIcons = {
    success: 'fi-rr-check-circle',
    warning: 'fi-rr-exclamation',
    critical: 'fi-rr-cross-circle',
    error: 'fi-rr-cross-circle',
    info: 'fi-rr-info',
    task: 'fi-rr-clipboard-list-check',
    payment: 'fi-rr-credit-card',
    order: 'fi-rr-shopping-bag',
    chat: 'fi-rr-comment',
    deadline: 'fi-rr-clock'
  };

  const typeColors = {
    success: 'bg-green-100 text-green-600',
    warning: 'bg-amber-100 text-amber-600',
    critical: 'bg-red-100 text-red-600',
    error: 'bg-red-100 text-red-600',
    info: 'bg-blue-100 text-blue-600',
    task: 'bg-purple-100 text-purple-600',
    payment: 'bg-emerald-100 text-emerald-600',
    order: 'bg-indigo-100 text-indigo-600',
    chat: 'bg-cyan-100 text-cyan-600',
    deadline: 'bg-orange-100 text-orange-600'
  };

  const notifType = (notification.type || 'info').toString().toLowerCase();
  const icon = typeIcons[notifType] || typeIcons.info;
  const color = typeColors[notifType] || typeColors.info;
  const timeAgo = formatTimeAgo(notification.created_at || notification.createdAt);
  const bgClass = notification.is_read ? '' : 'bg-indigo-50/50';
  const linkUrl = notification.link_url || notification.link || '';

  // Support multiple id field names
  const notifId = notification.notification_id || notification.id || notification.notificationId;

  return `
        <div class="p-3 border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors ${bgClass}" 
          onclick="handleNotificationClick(${notifId}, '${linkUrl}')">
      <div class="flex gap-3">
        <div class="w-9 h-9 rounded-full ${color} flex-shrink-0 flex items-center justify-center">
          <i class="fi ${icon} text-sm"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-2">
            <p class="text-sm font-semibold text-slate-800 ${notification.is_read ? '' : 'text-indigo-900'} line-clamp-1">${escapeHtml(notification.title)}</p>
            ${!notification.is_read ? '<span class="w-2 h-2 bg-indigo-500 rounded-full flex-shrink-0 mt-1.5"></span>' : ''}
          </div>
          <p class="text-xs text-slate-500 leading-relaxed mt-0.5 line-clamp-2">${escapeHtml(notification.message)}</p>
          <p class="text-[10px] text-slate-400 mt-1 font-medium">${timeAgo}</p>
        </div>
      </div>
    </div>
  `;
}

/**
 * Add new notification to DOM
 */
function addNotificationToDOM(notification) {
  const container = document.getElementById('notif-list');
  if (!container) return;

  // Check if modal is visible
  const modal = document.getElementById('notif-modal');
  const isVisible = modal && !modal.classList.contains('hidden');

  // Prepend new notification
  const notifHTML = createNotificationHTML(notification);
  if (container.children.length === 0 || container.children[0].textContent.includes('No notifications')) {
    container.innerHTML = notifHTML;
  } else {
    container.insertAdjacentHTML('afterbegin', notifHTML);
  }

  // Play sound or show animation
  if (isVisible) {
    container.firstElementChild.style.animation = 'slideIn 0.3s ease-out';
  }
}

/**
 * Increment unread count
 */
function incrementUnreadCount() {
  unreadCount++;
  updateNotificationBadge();
}

/**
 * Update notification badge
 */
function updateNotificationBadge() {
  const badge = document.getElementById('notif-badge');
  const badgeDot = document.querySelector('#notif-btn .bg-red-500');
  
  if (badge) {
    if (unreadCount > 0) {
      badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
  
  if (badgeDot) {
    if (unreadCount > 0) {
      badgeDot.classList.remove('hidden');
    } else {
      badgeDot.classList.add('hidden');
    }
  }
}

/**
 * Handle notification click
 */
async function handleNotificationClick(notificationId, linkUrl) {
  // Mark as read
  try {
    await fetch(`/notifications/${notificationId}/read`, {
      method: 'PATCH',
      credentials: 'include'
    });

    unreadCount = Math.max(0, unreadCount - 1);
    updateNotificationBadge();
    
    // Update the notification item in DOM
    const notifItems = document.querySelectorAll('#notif-list > div');
    notifItems.forEach(item => {
      if (item.getAttribute('onclick')?.includes(notificationId)) {
        item.classList.remove('bg-indigo-50/50');
        const dot = item.querySelector('.bg-indigo-500');
        if (dot) dot.remove();
      }
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
  }

  // Navigate if link provided
  if (linkUrl && linkUrl.trim()) {
    window.location.href = linkUrl;
  }
}

/**
 * Mark all as read
 */
async function markAllAsRead() {
  try {
    const response = await fetch('/notifications/all/read', {
      method: 'PATCH',
      credentials: 'include'
    });

    if (response.ok) {
      unreadCount = 0;
      updateNotificationBadge();
      
      // Update all notification items
      document.querySelectorAll('#notif-list > div').forEach(item => {
        item.classList.remove('bg-indigo-50/50');
        const dot = item.querySelector('.bg-indigo-500');
        if (dot) dot.remove();
      });
      
      if (typeof showToast === 'function') {
        showToast('All notifications marked as read', 'success');
      }
    }
  } catch (error) {
    console.error('Error marking all as read:', error);
  }
}

/**
 * Show critical toast notification
 */
function showCriticalToast(title, message, linkUrl) {
  showNotificationToast('critical', title, message, linkUrl);
}

/**
 * Show notification toast with type-based styling
 */
function showNotificationToast(type, title, message, linkUrl) {
  // Type-based styling
  const typeStyles = {
    success: { bg: 'bg-green-600', icon: 'fi-rr-check-circle' },
    warning: { bg: 'bg-amber-500', icon: 'fi-rr-exclamation' },
    critical: { bg: 'bg-red-600', icon: 'fi-rr-cross-circle' },
    error: { bg: 'bg-red-600', icon: 'fi-rr-cross-circle' },
    info: { bg: 'bg-indigo-600', icon: 'fi-rr-info' },
    task: { bg: 'bg-purple-600', icon: 'fi-rr-clipboard-list-check' },
    payment: { bg: 'bg-emerald-600', icon: 'fi-rr-credit-card' },
    order: { bg: 'bg-indigo-600', icon: 'fi-rr-shopping-bag' },
    chat: { bg: 'bg-cyan-600', icon: 'fi-rr-comment' },
    deadline: { bg: 'bg-orange-600', icon: 'fi-rr-clock' }
  };
  
  const style = typeStyles[type] || typeStyles.info;
  
  // Create toast container if not exists
  let toastContainer = document.getElementById('toast-container-notif');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container-notif';
    toastContainer.className = 'fixed top-4 right-4 z-[9999] space-y-2';
    toastContainer.style.maxWidth = '380px';
    document.body.appendChild(toastContainer);
  }
  
  // Create toast element
  const toast = document.createElement('div');
  toast.className = `${style.bg} text-white p-4 rounded-xl shadow-2xl transform translate-x-full transition-transform duration-300`;
  toast.innerHTML = `
    <div class="flex items-start gap-3">
      <i class="fi ${style.icon} text-xl mt-0.5 flex-shrink-0"></i>
      <div class="flex-1 min-w-0">
        <p class="font-bold text-sm">${escapeHtml(title)}</p>
        <p class="text-xs mt-1 opacity-90 line-clamp-2">${escapeHtml(message)}</p>
      </div>
      <button onclick="event.stopPropagation(); this.parentElement.parentElement.remove()" class="text-white/80 hover:text-white text-lg leading-none font-bold">&times;</button>
    </div>
  `;

  if (linkUrl && linkUrl.trim()) {
    toast.style.cursor = 'pointer';
    toast.onclick = (e) => {
      if (e.target.tagName !== 'BUTTON') {
        window.location.href = linkUrl;
      }
    };
  }

  toastContainer.appendChild(toast);
  
  // Animate in
  requestAnimationFrame(() => {
    toast.classList.remove('translate-x-full');
    toast.classList.add('translate-x-0');
  });

  // Auto-remove after 6 seconds
  setTimeout(() => {
    toast.classList.add('translate-x-full');
    setTimeout(() => toast.remove(), 300);
  }, 6000);
  
  // Play notification sound if available
  try {
    if (window.notificationSound) {
      window.notificationSound.play().catch(() => {});
    }
  } catch (e) {}
}

/**
 * Update connection status indicator
 */
function updateConnectionStatus(status) {
  // Can be overridden by specific headers
  if (typeof onConnectionStatusChange === 'function') {
    onConnectionStatusChange(status);
  }
}

/**
 * Get context code from URL
 */
function getContextCodeFromURL() {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  
  // Check for work_code or query_code in URL params
  const workCode = params.get('work_code');
  const queryCode = params.get('query_code');
  
  if (workCode) return 'WORK_' + workCode;
  if (queryCode) return 'QUERY_' + queryCode;
  
  // Check URL path patterns
  const workMatch = path.match(/\/orders\/(WORK_[A-Z0-9]+)/);
  const queryMatch = path.match(/\/queries\/(QUERY_[A-Z0-9]+)/);
  
  if (workMatch) return workMatch[1];
  if (queryMatch) return queryMatch[1];
  
  return null;
}

/**
 * Format time ago
 */
function formatTimeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString();
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Add CSS animation for notifications
const notifStyles = document.createElement('style');
notifStyles.textContent = `
  @keyframes slideInNotif {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  .line-clamp-1 { display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
  .line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
`;
document.head.appendChild(notifStyles);

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRealtimeNotifications);
} else {
  initRealtimeNotifications();
}

// Export for global use
window.realtimeNotifications = {
  socket: () => notificationSocket,
  loadNotifications,
  loadUnreadCount,
  markAllAsRead
};
