(() => {
  'use strict';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('nav');
  const setMenu = (open) => {
    nav.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  };
  toggle.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) setMenu(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && nav.classList.contains('open')) {
      setMenu(false);
      toggle.focus();
    }
  });
  window.matchMedia('(min-width: 900px)').addEventListener('change', (media) => {
    if (media.matches) setMenu(false);
  });

  const items = document.querySelectorAll('.reveal');
  if (reduce || !('IntersectionObserver' in window)) {
    items.forEach((element) => element.classList.remove('reveal'));
  } else {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const element = entry.target;
        element.classList.add('in');
        observer.unobserve(element);
        const finish = (event) => {
          if (event.propertyName !== 'opacity') return;
          element.removeEventListener('transitionend', finish);
          element.classList.remove('reveal', 'in');
          element.style.removeProperty('--d');
        };
        element.addEventListener('transitionend', finish);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

    document.querySelectorAll('[data-stagger]').forEach((group) => {
      group.querySelectorAll(':scope > .reveal').forEach((element, index) => {
        element.style.setProperty('--d', `${(index % 3) * 110}ms`);
      });
    });
    items.forEach((element) => observer.observe(element));
  }

  const links = [...nav.querySelectorAll('a')];
  const sections = links.map((link) => document.querySelector(link.getAttribute('href'))).filter(Boolean);
  if ('IntersectionObserver' in window) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((link) => {
          const active = link.getAttribute('href') === `#${entry.target.id}`;
          link.classList.toggle('active', active);
          if (active) link.setAttribute('aria-current', 'true');
          else link.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach((section) => spy.observe(section));
  }

  const languageButtons = document.querySelectorAll('.lang-btn');
  languageButtons.forEach((button) => {
    button.addEventListener('click', () => {
      languageButtons.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      document.documentElement.lang = button.dataset.lang;
    });
  });
})();