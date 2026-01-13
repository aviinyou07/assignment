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
  // Get JWT token from localStorage or meta tag
  const token = localStorage.getItem('authToken') || 
                document.querySelector('meta[name="auth-token"]')?.content ||
                document.cookie.match(/authToken=([^;]+)/)?.[1];

  if (!token) {
    console.warn('No auth token found for WebSocket connection');
    return;
  }

  // Load Socket.IO if not already loaded
  if (typeof io === 'undefined') {
    const script = document.createElement('script');
    script.src = '/socket.io/socket.io.js';
    script.onload = () => connectSocket(token);
    document.head.appendChild(script);
  } else {
    connectSocket(token);
  }
}

/**
 * Connect to Socket.IO server
 */
function connectSocket(token) {
  notificationSocket = io({
    auth: {
      token: 'Bearer ' + token
    },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5
  });

  // Connection events
  notificationSocket.on('connect', () => {
    console.log('✓ Connected to real-time notifications');
    updateConnectionStatus('online');
    
    // Load initial notifications
    loadNotifications();
    loadUnreadCount();
  });

  notificationSocket.on('disconnect', () => {
    console.log('✗ Disconnected from real-time notifications');
    updateConnectionStatus('offline');
  });

  notificationSocket.on('error', (error) => {
    console.error('Socket error:', error);
  });

  // Real-time notification events
  notificationSocket.on('notification:new', (notification) => {
    console.log('📬 New notification:', notification);
    addNotificationToDOM(notification);
    incrementUnreadCount();
    updateNotificationBadge();
    
    // Show toast for critical notifications
    if (notification.type === 'critical') {
      showCriticalToast(notification.title, notification.message, notification.link_url);
    }
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
}

/**
 * Load notifications from API
 */
async function loadNotifications() {
  try {
    const token = localStorage.getItem('authToken') || 
                  document.querySelector('meta[name="auth-token"]')?.content;
    
    const response = await fetch('/notifications?page=0&limit=20', {
      headers: {
        'Authorization': 'Bearer ' + token
      }
    });

    if (response.ok) {
      const data = await response.json();
      renderNotifications(data.notifications || data.data?.notifications || []);
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
    const token = localStorage.getItem('authToken') || 
                  document.querySelector('meta[name="auth-token"]')?.content;
    
    const response = await fetch('/notifications/unread-count', {
      headers: {
        'Authorization': 'Bearer ' + token
      }
    });

    if (response.ok) {
      const data = await response.json();
      unreadCount = data.unread || data.unreadCount || 0;
      updateNotificationBadge();
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

  if (notifications.length === 0) {
    container.innerHTML = '<div class="p-4 text-center text-slate-400 text-sm">No notifications</div>';
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
    warning: 'fi-rr-exclamation-triangle',
    critical: 'fi-rr-cross-circle',
    info: 'fi-rr-info'
  };

  const typeColors = {
    success: 'bg-green-100 text-green-600',
    warning: 'bg-amber-100 text-amber-600',
    critical: 'bg-red-100 text-red-600',
    info: 'bg-indigo-100 text-indigo-600'
  };

  const icon = typeIcons[notification.type] || typeIcons.info;
  const color = typeColors[notification.type] || typeColors.info;
  const timeAgo = formatTimeAgo(notification.created_at);
  const bgClass = notification.is_read ? '' : 'bg-slate-50/50';

  return `
    <div class="p-4 border-b border-slate-50 hover:bg-slate-50 cursor-pointer transition-colors ${bgClass}" 
         onclick="handleNotificationClick(${notification.notification_id}, '${notification.link_url || ''}')">
      <div class="flex gap-3">
        <div class="w-10 h-10 rounded-full ${color} flex-shrink-0 flex items-center justify-center">
          <i class="fi ${icon}"></i>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-slate-800">${escapeHtml(notification.title)}</p>
          <p class="text-xs text-slate-500 leading-relaxed mt-1">${escapeHtml(notification.message)}</p>
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
    const token = localStorage.getItem('authToken') || 
                  document.querySelector('meta[name="auth-token"]')?.content;
    
    await fetch(`/notifications/${notificationId}/read`, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + token
      }
    });

    unreadCount = Math.max(0, unreadCount - 1);
    updateNotificationBadge();
  } catch (error) {
    console.error('Error marking notification as read:', error);
  }

  // Navigate if link provided
  if (linkUrl) {
    window.location.href = linkUrl;
  }
}

/**
 * Mark all as read
 */
async function markAllAsRead() {
  try {
    const token = localStorage.getItem('authToken') || 
                  document.querySelector('meta[name="auth-token"]')?.content;
    
    const response = await fetch('/notifications/all/read', {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + token
      }
    });

    if (response.ok) {
      unreadCount = 0;
      updateNotificationBadge();
      loadNotifications(); // Reload to update UI
    }
  } catch (error) {
    console.error('Error marking all as read:', error);
  }
}

/**
 * Show critical toast notification
 */
function showCriticalToast(title, message, linkUrl) {
  // Create toast element
  const toast = document.createElement('div');
  toast.className = 'fixed top-4 right-4 bg-red-600 text-white p-4 rounded-lg shadow-lg z-50 max-w-md animate-slide-in';
  toast.innerHTML = `
    <div class="flex items-start gap-3">
      <i class="fi fi-rr-cross-circle text-xl"></i>
      <div class="flex-1">
        <p class="font-bold">${escapeHtml(title)}</p>
        <p class="text-sm mt-1 opacity-90">${escapeHtml(message)}</p>
      </div>
      <button onclick="this.parentElement.parentElement.remove()" class="text-white/80 hover:text-white">✕</button>
    </div>
  `;

  if (linkUrl) {
    toast.style.cursor = 'pointer';
    toast.onclick = () => window.location.href = linkUrl;
  }

  document.body.appendChild(toast);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    toast.remove();
  }, 5000);
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
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

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
