/* ============================================
   MLINJANA FINANCIAL GROUP - Main JS
   ============================================ */

// ── Navbar scroll behavior ──────────────────
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 60);
});

// ── Mobile menu toggle ──────────────────────
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobileMenu');
const mobileClose = document.getElementById('mobileClose');

hamburger.addEventListener('click', () => {
  mobileMenu.classList.add('active');
  document.body.style.overflow = 'hidden';
});

mobileClose.addEventListener('click', closeMobileMenu);

document.querySelectorAll('.mobile-menu a').forEach(link => {
  link.addEventListener('click', closeMobileMenu);
});

function closeMobileMenu() {
  mobileMenu.classList.remove('active');
  document.body.style.overflow = '';
}

// ── Scroll reveal ───────────────────────────
const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
);

document.querySelectorAll('.reveal, .reveal-left, .reveal-right').forEach(el => {
  revealObserver.observe(el);
});

// ── Counter animation ───────────────────────
function animateCounter(el, target, suffix = '', prefix = '') {
  const duration = 2000;
  const start = performance.now();
  const isDecimal = target % 1 !== 0;

  const tick = (now) => {
    const elapsed = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - elapsed, 3);
    const value = isDecimal
      ? (ease * target).toFixed(1)
      : Math.round(ease * target);
    el.textContent = prefix + value.toLocaleString('en-ZA') + suffix;
    if (elapsed < 1) requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}

const counterObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const target = parseFloat(el.dataset.target);
        const suffix = el.dataset.suffix || '';
        const prefix = el.dataset.prefix || '';
        animateCounter(el, target, suffix, prefix);
        counterObserver.unobserve(el);
      }
    });
  },
  { threshold: 0.5 }
);

document.querySelectorAll('[data-target]').forEach(el => {
  counterObserver.observe(el);
});

// ── Particle animation in hero ──────────────
(function createParticles() {
  const container = document.getElementById('heroParticles');
  if (!container) return;

  for (let i = 0; i < 40; i++) {
    const p = document.createElement('div');
    const size = Math.random() * 3 + 1;
    const isGold = Math.random() > 0.5;

    Object.assign(p.style, {
      position: 'absolute',
      width: size + 'px',
      height: size + 'px',
      borderRadius: '50%',
      background: isGold ? 'rgba(201,168,76,0.4)' : 'rgba(255,255,255,0.15)',
      left: Math.random() * 100 + '%',
      top: Math.random() * 100 + '%',
      animation: `floatParticle ${6 + Math.random() * 10}s ease-in-out ${Math.random() * 5}s infinite`,
    });

    container.appendChild(p);
  }

  const styleTag = document.createElement('style');
  styleTag.textContent = `
    @keyframes floatParticle {
      0%, 100% { transform: translateY(0) scale(1); opacity: 0.4; }
      50% { transform: translateY(-${20 + Math.random() * 40}px) scale(1.2); opacity: 0.8; }
    }
  `;
  document.head.appendChild(styleTag);
})();

// ── Debt → Wealth counter animation ─────────
(function debtToWealthAnimation() {
  const debtEl = document.getElementById('debtAmount');
  const incomeEl = document.getElementById('incomeAmount');
  const differenceEl = document.getElementById('differenceAmount');

  if (!debtEl) return;

  let animating = false;

  const observer = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && !animating) {
      animating = true;
      setTimeout(() => {
        animateCounter(debtEl, 16086, '', 'R');
        setTimeout(() => animateCounter(incomeEl, 10000, '', 'R'), 300);
        setTimeout(() => animateCounter(differenceEl, 6086, '', 'R'), 600);
      }, 400);
    }
  }, { threshold: 0.5 });

  observer.observe(debtEl);
})();

// ── Debt Assessment Calculator ───────────────
const calcForm = document.getElementById('calcForm');
if (calcForm) {
  calcForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const income = parseFloat(document.getElementById('monthlyIncome').value) || 0;
    const debt = parseFloat(document.getElementById('totalDebt').value) || 0;
    const expenses = parseFloat(document.getElementById('monthlyExpenses').value) || 0;
    const rate = parseFloat(document.getElementById('interestRate').value) || 0;

    const totalObligations = debt + expenses;
    const surplus = income - totalObligations;
    const debtRatio = totalObligations > 0 ? ((totalObligations / income) * 100).toFixed(1) : 0;
    const yearsToPayoff = surplus > 0 ? (debt / (surplus * 12)).toFixed(1) : '∞';
    const totalInterest = debt * (rate / 100) * (surplus > 0 ? parseFloat(yearsToPayoff) : 10);

    document.getElementById('resultIncome').textContent = 'R' + income.toLocaleString('en-ZA');
    document.getElementById('resultObligations').textContent = 'R' + totalObligations.toLocaleString('en-ZA');

    const surplusEl = document.getElementById('resultSurplus');
    surplusEl.textContent = (surplus >= 0 ? '+R' : '-R') + Math.abs(surplus).toLocaleString('en-ZA');
    surplusEl.className = 'result-value large ' + (surplus >= 0 ? 'positive' : 'negative');

    document.getElementById('resultRatio').textContent = debtRatio + '%';
    document.getElementById('resultPayoff').textContent = yearsToPayoff === '∞' ? '∞ years (needs intervention)' : yearsToPayoff + ' years';
    document.getElementById('resultInterest').textContent = 'R' + Math.round(totalInterest).toLocaleString('en-ZA');

    const statusEl = document.getElementById('calcStatus');
    if (surplus < 0) {
      statusEl.textContent = '⚠️ Critical: Your obligations exceed income. You need immediate financial intervention.';
      statusEl.className = 'calc-status danger';
    } else if (debtRatio > 40) {
      statusEl.textContent = '⚡ Warning: Your debt ratio is high. Financial coaching recommended.';
      statusEl.className = 'calc-status warning';
    } else {
      statusEl.textContent = '✅ Good foundation. Wealth-building strategies can be implemented.';
      statusEl.className = 'calc-status ok';
    }

    document.getElementById('calcResult').classList.add('visible');
    document.getElementById('calcResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

// ── Newsletter form ──────────────────────────
const newsletterForm = document.getElementById('newsletterForm');
if (newsletterForm) {
  newsletterForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const emailInput = newsletterForm.querySelector('input[type="email"]');
    const btn = newsletterForm.querySelector('button');
    const original = btn.textContent;

    btn.textContent = '✓ You\'re in!';
    btn.style.background = '#2ecc71';
    btn.style.color = 'white';
    emailInput.value = '';

    setTimeout(() => {
      btn.textContent = original;
      btn.style.background = '';
      btn.style.color = '';
    }, 3000);
  });
}

// ── Smooth scroll for anchor links ──────────
document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener('click', (e) => {
    const target = document.querySelector(link.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// ── Active nav link highlight ────────────────
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.nav-links a[href^="#"]');

window.addEventListener('scroll', () => {
  let current = '';
  sections.forEach(section => {
    if (window.scrollY >= section.offsetTop - 100) {
      current = '#' + section.id;
    }
  });

  navLinks.forEach(link => {
    link.style.color = link.getAttribute('href') === current
      ? 'var(--gold)'
      : '';
  });
}, { passive: true });

// ── Testimonial auto-scroll (mobile) ─────────
const testimonialsGrid = document.querySelector('.testimonials-grid');
let autoScrollInterval = null;

function startTestimonialScroll() {
  if (window.innerWidth > 768 || !testimonialsGrid) return;
  let scrollPos = 0;
  const cards = testimonialsGrid.querySelectorAll('.testimonial-card');
  if (cards.length === 0) return;

  autoScrollInterval = setInterval(() => {
    scrollPos = (scrollPos + 1) % cards.length;
    cards[scrollPos].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  }, 4000);
}

startTestimonialScroll();
window.addEventListener('resize', () => {
  clearInterval(autoScrollInterval);
  startTestimonialScroll();
});
