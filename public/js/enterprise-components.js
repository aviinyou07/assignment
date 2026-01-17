/**
 * ENTERPRISE COMPONENTS - Assignment366
 * Premium UI components for enterprise-level workflow management
 */

// ===================================================================
// STATUS CONFIGURATION - Aligned with Order State Machine
// ===================================================================
const STATUS_CONFIG = {
  // Query Phase (26-27)
  26: { name: 'Pending Query', phase: 'QUERY', color: 'amber', icon: 'fi-rr-envelope', priority: 'normal' },
  27: { name: 'Quotation Sent', phase: 'QUERY', color: 'purple', icon: 'fi-rr-file-invoice', priority: 'normal' },
  
  // Payment Phase (28-30)
  28: { name: 'Quote Accepted', phase: 'PAYMENT', color: 'blue', icon: 'fi-rr-thumbs-up', priority: 'normal' },
  29: { name: 'Payment Submitted', phase: 'PAYMENT', color: 'orange', icon: 'fi-rr-credit-card', priority: 'high' },
  30: { name: 'Payment Verified', phase: 'PAYMENT', color: 'emerald', icon: 'fi-rr-check-circle', priority: 'normal' },
  
  // Execution Phase (31-33)
  31: { name: 'Writer Assigned', phase: 'EXECUTION', color: 'indigo', icon: 'fi-rr-user-add', priority: 'normal' },
  32: { name: 'In Progress', phase: 'EXECUTION', color: 'blue', icon: 'fi-rr-edit', priority: 'normal' },
  33: { name: 'Submitted for QC', phase: 'EXECUTION', color: 'violet', icon: 'fi-rr-document-signed', priority: 'high' },
  
  // QC Phase (34-36)
  34: { name: 'Under QC Review', phase: 'QC', color: 'violet', icon: 'fi-rr-zoom-in', priority: 'high' },
  35: { name: 'Revision Required', phase: 'QC', color: 'rose', icon: 'fi-rr-redo', priority: 'high' },
  36: { name: 'Approved', phase: 'QC', color: 'emerald', icon: 'fi-rr-badge-check', priority: 'normal' },
  
  // Delivery Phase (37-39)
  37: { name: 'Ready for Delivery', phase: 'DELIVERY', color: 'teal', icon: 'fi-rr-paper-plane', priority: 'high' },
  38: { name: 'Delivered', phase: 'DELIVERY', color: 'green', icon: 'fi-rr-rocket-lunch', priority: 'normal' },
  39: { name: 'Completed', phase: 'DELIVERY', color: 'green', icon: 'fi-rr-trophy', priority: 'normal' },
  
  // Terminal States (40-45)
  40: { name: 'Query Rejected', phase: 'TERMINAL', color: 'slate', icon: 'fi-rr-cross-circle', priority: 'low' },
  41: { name: 'Quote Declined', phase: 'TERMINAL', color: 'slate', icon: 'fi-rr-ban', priority: 'low' },
  42: { name: 'Payment Failed', phase: 'TERMINAL', color: 'red', icon: 'fi-rr-credit-card-alt', priority: 'low' },
  43: { name: 'Writer Declined', phase: 'TERMINAL', color: 'slate', icon: 'fi-rr-user-remove', priority: 'low' },
  44: { name: 'QC Failed', phase: 'TERMINAL', color: 'red', icon: 'fi-rr-badge-times', priority: 'low' },
  45: { name: 'Cancelled', phase: 'TERMINAL', color: 'slate', icon: 'fi-rr-cancel', priority: 'low' }
};

// Color class mappings for Tailwind
const COLOR_CLASSES = {
  amber: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200', gradient: 'from-amber-500 to-orange-600' },
  purple: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200', gradient: 'from-purple-500 to-violet-600' },
  blue: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200', gradient: 'from-blue-500 to-indigo-600' },
  orange: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200', gradient: 'from-orange-500 to-amber-600' },
  emerald: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200', gradient: 'from-emerald-500 to-teal-600' },
  indigo: { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-200', gradient: 'from-indigo-500 to-blue-600' },
  violet: { bg: 'bg-violet-100', text: 'text-violet-700', border: 'border-violet-200', gradient: 'from-violet-500 to-purple-600' },
  rose: { bg: 'bg-rose-100', text: 'text-rose-700', border: 'border-rose-200', gradient: 'from-rose-500 to-red-600' },
  teal: { bg: 'bg-teal-100', text: 'text-teal-700', border: 'border-teal-200', gradient: 'from-teal-500 to-emerald-600' },
  green: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200', gradient: 'from-green-500 to-emerald-600' },
  red: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200', gradient: 'from-red-500 to-rose-600' },
  slate: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200', gradient: 'from-slate-500 to-slate-600' }
};

// ===================================================================
// PREMIUM STATUS BADGE COMPONENT
// ===================================================================
function createStatusBadge(statusId, size = 'default') {
  const config = STATUS_CONFIG[statusId] || { name: `Status ${statusId}`, color: 'slate', icon: 'fi-rr-question' };
  const colors = COLOR_CLASSES[config.color];
  
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-[10px]',
    default: 'px-3 py-1 text-xs',
    lg: 'px-4 py-2 text-sm'
  };
  
  return `
    <span class="${colors.bg} ${colors.text} ${colors.border} border ${sizeClasses[size]} rounded-full font-bold inline-flex items-center gap-1.5">
      <i class="fi ${config.icon}"></i>
      ${config.name}
    </span>
  `;
}

// ===================================================================
// WORKFLOW TIMELINE COMPONENT
// ===================================================================
function createWorkflowTimeline(currentStatus) {
  const phases = [
    { id: 'QUERY', name: 'Query', icon: 'fi-rr-envelope', statuses: [26, 27] },
    { id: 'PAYMENT', name: 'Payment', icon: 'fi-rr-credit-card', statuses: [28, 29, 30] },
    { id: 'EXECUTION', name: 'Execution', icon: 'fi-rr-edit', statuses: [31, 32, 33] },
    { id: 'QC', name: 'QC', icon: 'fi-rr-badge-check', statuses: [34, 35, 36] },
    { id: 'DELIVERY', name: 'Delivery', icon: 'fi-rr-rocket-lunch', statuses: [37, 38, 39] }
  ];
  
  const currentConfig = STATUS_CONFIG[currentStatus];
  const currentPhase = currentConfig?.phase || 'QUERY';
  
  return `
    <div class="flex items-center justify-between gap-2 py-4">
      ${phases.map((phase, index) => {
        const isActive = phase.id === currentPhase;
        const isPast = phases.findIndex(p => p.id === currentPhase) > index;
        const status = isPast ? 'completed' : isActive ? 'active' : 'pending';
        
        const statusClasses = {
          completed: 'bg-emerald-500 text-white',
          active: 'bg-indigo-500 text-white animate-pulse',
          pending: 'bg-slate-200 text-slate-400'
        };
        
        const lineClasses = {
          completed: 'bg-emerald-500',
          active: 'bg-gradient-to-r from-emerald-500 to-indigo-500',
          pending: 'bg-slate-200'
        };
        
        return `
          <div class="flex items-center ${index < phases.length - 1 ? 'flex-1' : ''}">
            <div class="flex flex-col items-center">
              <div class="w-10 h-10 rounded-xl ${statusClasses[status]} flex items-center justify-center shadow-lg">
                <i class="fi ${phase.icon}"></i>
              </div>
              <span class="text-[10px] font-bold mt-1 ${status === 'pending' ? 'text-slate-400' : 'text-slate-700'}">${phase.name}</span>
            </div>
            ${index < phases.length - 1 ? `<div class="flex-1 h-1 ${lineClasses[status]} mx-2 rounded-full"></div>` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ===================================================================
// URGENCY BADGE COMPONENT
// ===================================================================
function createUrgencyBadge(urgency) {
  const configs = {
    'Urgent': { bg: 'bg-red-100', text: 'text-red-700', icon: 'fi-rr-alarm-exclamation', animate: 'animate-pulse' },
    'High': { bg: 'bg-orange-100', text: 'text-orange-700', icon: 'fi-rr-flame', animate: '' },
    'Medium': { bg: 'bg-amber-100', text: 'text-amber-700', icon: 'fi-rr-time-quarter-past', animate: '' },
    'Low': { bg: 'bg-green-100', text: 'text-green-700', icon: 'fi-rr-leaf', animate: '' }
  };
  
  const config = configs[urgency] || configs['Medium'];
  
  return `
    <span class="${config.bg} ${config.text} ${config.animate} px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1.5">
      <i class="fi ${config.icon}"></i>
      ${urgency}
    </span>
  `;
}

// ===================================================================
// DEADLINE COUNTDOWN COMPONENT
// ===================================================================
function createDeadlineCountdown(deadlineDate) {
  const deadline = new Date(deadlineDate);
  const now = new Date();
  const diff = deadline - now;
  
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  
  let urgencyClass, label;
  
  if (diff < 0) {
    urgencyClass = 'bg-red-100 text-red-700 border-red-200';
    label = 'OVERDUE';
  } else if (hours < 6) {
    urgencyClass = 'bg-red-100 text-red-700 border-red-200 animate-pulse';
    label = `${hours}h left`;
  } else if (hours < 24) {
    urgencyClass = 'bg-orange-100 text-orange-700 border-orange-200';
    label = `${hours}h left`;
  } else if (days < 3) {
    urgencyClass = 'bg-amber-100 text-amber-700 border-amber-200';
    label = `${days}d ${remainingHours}h`;
  } else {
    urgencyClass = 'bg-green-100 text-green-700 border-green-200';
    label = `${days} days`;
  }
  
  return `
    <span class="${urgencyClass} border px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1.5">
      <i class="fi fi-rr-clock"></i>
      ${label}
    </span>
  `;
}

// ===================================================================
// ACTIVITY CARD COMPONENT
// ===================================================================
function createActivityCard(activity) {
  const statusConfig = STATUS_CONFIG[activity.status] || { color: 'slate', icon: 'fi-rr-question' };
  const colors = COLOR_CLASSES[statusConfig.color];
  
  return `
    <div class="flex items-start gap-4 p-4 bg-white rounded-xl border border-slate-200 hover:shadow-md transition-all">
      <div class="w-10 h-10 rounded-lg bg-gradient-to-br ${colors.gradient} flex items-center justify-center text-white shadow-lg">
        <i class="fi ${statusConfig.icon}"></i>
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between gap-2">
          <p class="font-bold text-slate-800 truncate">${activity.work_code || activity.query_code || 'N/A'}</p>
          ${createStatusBadge(activity.status, 'sm')}
        </div>
        <p class="text-sm text-slate-500 truncate mt-1">${activity.paper_topic || 'No topic'}</p>
        <div class="flex items-center gap-3 mt-2 text-xs text-slate-400">
          <span><i class="fi fi-rr-user mr-1"></i>${activity.client_name || 'N/A'}</span>
          <span><i class="fi fi-rr-clock mr-1"></i>${new Date(activity.created_at).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  `;
}

// ===================================================================
// KPI CARD COMPONENT
// ===================================================================
function createKPICard(config) {
  const { title, value, subtitle, icon, color, href, badge, animate } = config;
  const colors = COLOR_CLASSES[color] || COLOR_CLASSES.slate;
  
  return `
    <a href="${href || '#'}" class="group relative bg-white rounded-2xl p-6 border border-slate-200/60 shadow-sm hover:shadow-xl hover:border-${color}-300 transition-all duration-300 overflow-hidden">
      <div class="absolute inset-0 bg-gradient-to-br ${colors.gradient.replace('from-', 'from-').replace('to-', 'to-')}/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
      <div class="relative">
        <div class="flex items-center justify-between mb-4">
          <div class="w-14 h-14 rounded-2xl bg-gradient-to-br ${colors.gradient} flex items-center justify-center shadow-lg shadow-${color}-500/30 ${animate ? 'animate-pulse' : ''}">
            <i class="fi ${icon} text-white text-2xl"></i>
          </div>
          ${badge ? `<span class="text-xs font-bold ${colors.text} ${colors.bg} px-3 py-1 rounded-full uppercase tracking-wider">${badge}</span>` : ''}
        </div>
        <p class="text-sm text-slate-500 font-semibold mb-1">${title}</p>
        <p class="text-4xl font-black text-slate-800">${value}</p>
        ${subtitle ? `<div class="mt-3 flex items-center text-xs ${colors.text} font-bold"><i class="fi fi-rr-arrow-right mr-1"></i>${subtitle}</div>` : ''}
      </div>
    </a>
  `;
}

// ===================================================================
// GLOBAL SEARCH COMPONENT (Command Palette)
// ===================================================================
let globalSearchOpen = false;

function openGlobalSearch() {
  const modal = document.getElementById('global-search-modal');
  if (modal) {
    modal.classList.remove('hidden');
    globalSearchOpen = true;
    setTimeout(() => {
      document.getElementById('global-search-input')?.focus();
    }, 100);
  }
}

function closeGlobalSearch() {
  const modal = document.getElementById('global-search-modal');
  if (modal) {
    modal.classList.add('hidden');
    globalSearchOpen = false;
  }
}

// Keyboard shortcut for search
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    if (globalSearchOpen) {
      closeGlobalSearch();
    } else {
      openGlobalSearch();
    }
  }
  
  if (e.key === 'Escape' && globalSearchOpen) {
    closeGlobalSearch();
  }
});

// ===================================================================
// REAL-TIME UPDATE UTILITIES
// ===================================================================
function updateKPIValue(elementId, newValue, animate = true) {
  const element = document.getElementById(elementId);
  if (!element) return;
  
  const oldValue = parseInt(element.textContent) || 0;
  
  if (animate && Math.abs(newValue - oldValue) > 0) {
    element.classList.add('scale-110', 'text-indigo-600');
    setTimeout(() => {
      element.textContent = newValue;
      element.classList.remove('scale-110', 'text-indigo-600');
    }, 150);
  } else {
    element.textContent = newValue;
  }
}

// Periodic dashboard refresh
function startDashboardRefresh(intervalMs = 30000) {
  setInterval(async () => {
    try {
      const response = await fetch('/dashboard/kpis');
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.kpis) {
          Object.keys(data.kpis).forEach(key => {
            updateKPIValue(`kpi-${key}`, data.kpis[key]);
          });
        }
      }
    } catch (error) {
      console.log('Dashboard refresh skipped');
    }
  }, intervalMs);
}

// ===================================================================
// EXPORT FOR MODULE USE
// ===================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STATUS_CONFIG,
    COLOR_CLASSES,
    createStatusBadge,
    createWorkflowTimeline,
    createUrgencyBadge,
    createDeadlineCountdown,
    createActivityCard,
    createKPICard
  };
}
