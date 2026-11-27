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

  const languageButtons = [...document.querySelectorAll('.lang-btn')];
  const ptToEn = {
  "Projetos": "Projects",
  "Conhecimentos": "Skills",
  "Experiência": "Experience",
  "Sobre": "About",
  "Currículo": "Resume",
  "Contato": "Contact",
  "Desenvolvedor Web Júnior · Front-end": "Junior Web Developer · Front-end",
  "Khristopher Vasconcellos Vieira": "Khristopher Vasconcellos Vieira",
  "Desenvolvo sites e lojas virtuais responsivos, da interface à publicação. Minha experiência em TI corporativa também envolve suporte técnico, SAP Business One, consultas SQL e automação com Python.": "I build responsive websites and online stores, from interface design to deployment. My corporate IT experience also includes technical support, SAP Business One, SQL queries, and Python automation.",
  "Ver projetos": "View projects",
  "Projetos selecionados": "Selected projects",
  "Loja virtual de maquiagem e cosméticos": "Online makeup and cosmetics store",
  "Entregue": "Completed",
  "Catálogo de produtos e carrinho": "Product catalog and shopping cart",
  "Checkout via WhatsApp": "WhatsApp checkout",
  "Opções de retirada e entrega": "Pickup and delivery options",
  "Painel administrativo para gerenciamento de imagens": "Admin panel for image management",
  "Feed do Instagram": "Instagram feed",
  "Consentimento de cookies": "Cookie consent",
  "Site": "Website",
  "GitHub": "GitHub",
  "Loja virtual de artesanato em feltro": "Handmade felt craft online store",
  "Identidade visual própria": "Custom visual identity",
  "Catálogo e carrinho": "Catalog and shopping cart",
  "Domínio personalizado": "Custom domain",
  "Aplicativo de passagens bíblicas": "Bible passages application",
  "Em desenvolvimento": "In development",
  "Relaciona situações e sentimentos a passagens bíblicas.": "Connects life situations and feelings with Bible passages.",
  "Referências verificáveis": "Verifiable references",
  "Atenção ao contexto dos textos": "Attention to the context of the texts",
  "Integração com inteligência artificial": "Artificial intelligence integration",
  "Projeto": "Project",
  "Outros projetos": "Other projects",
  "Site institucional": "Business website",
  "Site institucional responsivo para apresentação de serviços contábeis, com atendimento direto pelo WhatsApp.": "Responsive business website presenting accounting services, with direct WhatsApp contact.",
  "Atendimento automatizado para escritório de contabilidade": "Automated support for an accounting firm",
  "Respostas automáticas por palavras-chave": "Keyword-based automatic replies",
  "Atendimento de perguntas frequentes": "Frequently asked questions",
  "Transcrição local de áudio com OpenAI Whisper": "Local audio transcription with OpenAI Whisper",
  "Aplicação em Python": "Python application",
  "Busca e organiza oportunidades de trabalho nas áreas de suporte, help desk e desenvolvimento júnior.": "Finds and organizes job opportunities in support, help desk, and junior development.",
  "Site pessoal": "Personal website",
  "Apresenta projetos, conhecimentos, experiência profissional e currículo.": "Showcases projects, skills, professional experience, and resume.",
  "Conhecimentos técnicos": "Technical skills",
  "HTML5, CSS3 e JavaScript ES6+": "HTML5, CSS3, and JavaScript ES6+",
  "Design responsivo, UI e componentização": "Responsive design, UI, and component-based development",
  "Python e automação de processos": "Python and process automation",
  "API REST e integração de APIs": "REST APIs and API integration",
  "Vercel, Cloudflare, domínio e DNS": "Vercel, Cloudflare, domains, and DNS",
  "Segurança web e LGPD": "Web security and Brazil's LGPD data protection law",
  "Chatbots e integração com IA": "Chatbots and AI integration",
  "Experiência profissional": "Professional experience",
  "Auxiliar de TI": "IT Support Assistant",
  "Administração de usuários, licenças e acessos no SAP Business One 10.0 com SQL Server.": "Managed users, licenses, and access in SAP Business One 10.0 with SQL Server.",
  "Desenvolvimento, correção e formatação de consultas SQL e relatórios.": "Created, corrected, and formatted SQL queries and reports.",
  "Análise de ocorrências em compras, pagamentos, DDA e faturamento.": "Investigated issues involving purchasing, payments, DDA, and invoicing.",
  "Suporte a usuários, equipamentos, conectividade e drivers de rede.": "Provided support for users, equipment, connectivity, and network drivers.",
  "Automação de tarefas de manutenção com Python.": "Automated maintenance tasks with Python.",
  "Desenvolvedor Web e Suporte Técnico": "Web Developer and Technical Support",
  "Autônomo": "Freelance",
  "Desenvolvimento de sites e lojas virtuais para clientes e negócios familiares.": "Developed websites and online stores for clients and family businesses.",
  "Participação em todas as etapas, desde o layout até a publicação.": "Worked across all stages, from layout to deployment.",
  "Configuração de domínios e ajustes técnicos.": "Configured domains and handled technical adjustments.",
  "Suporte técnico e manutenção de computadores.": "Provided technical support and computer maintenance.",
  "Controlador de Acessos": "Access Control Officer",
  "Experiência profissional anterior na área de controle de acessos.": "Previous professional experience in access control.",
  "Desenvolvimento e suporte em tecnologia.": "Development and IT support.",
  "Sou formado em Análise e Desenvolvimento de Sistemas pela UNIP e atuo na área de tecnologia, combinando desenvolvimento web com suporte de TI em ambiente corporativo.": "I hold a degree in Systems Analysis and Development from UNIP and work in technology, combining web development with IT support in a corporate environment.",
  "Nos projetos web, trabalho desde a construção da interface até a publicação, configuração de domínio e ajustes. Na rotina de TI, atuo com SAP Business One, SQL, atendimento a usuários e automação de tarefas.": "In web projects, I work from interface development through deployment, domain configuration, and refinements. In IT operations, I work with SAP Business One, SQL, user support, and task automation.",
  "Formação": "Education",
  "Análise e Desenvolvimento de Sistemas": "Systems Analysis and Development",
  "Automação com Python": "Python Automation",
  "Cibersegurança": "Cybersecurity",
  "Idiomas": "Languages",
  "Português:": "Portuguese:",
  "nativo": "native",
  "Inglês:": "English:",
  "intermediário": "intermediate",
  "Espanhol:": "Spanish:",
  "Currículo profissional.": "Professional resume.",
  "Desenvolvedor Web Júnior · Front-end Developer": "Junior Web Developer · Front-end Developer",
  "Baixar currículo em PDF": "Download resume (PDF)",
  "Vamos conversar?": "Let's talk?",
  "Aberto a oportunidades em desenvolvimento web e tecnologia da informação.": "Open to opportunities in web development and information technology.",
  "E-mail": "Email",
  "Ir para o conteúdo": "Skip to content",
  "Abrir menu": "Open menu",
  "Fechar menu": "Close menu",
  "Idioma / Language": "Language"
};
  const originalTextNodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const key = node.nodeValue.trim();
    if (key && Object.prototype.hasOwnProperty.call(ptToEn, key)) {
      originalTextNodes.push({ node, original: node.nodeValue, translated: node.nodeValue.replace(key, ptToEn[key]) });
    }
  }
  const pageTitlePt = document.title;
  const pageTitleEn = 'Khristopher Vasconcellos Vieira | Junior Web Developer · Front-end';
  const description = document.querySelector('meta[name="description"]');
  const descriptionPt = description?.content || '';
  const descriptionEn = 'Portfolio of Khristopher Vasconcellos Vieira, junior web developer in Araraquara, Brazil. Responsive websites and online stores, corporate IT, SAP Business One, SQL, and Python automation.';
  let languageSwapTimer;
  const applyLanguage = (language) => {
    const english = language === 'en';
    originalTextNodes.forEach(({ node, original, translated }) => {
      if (node.isConnected) node.nodeValue = english ? translated : original;
    });
    document.documentElement.lang = english ? 'en' : 'pt-BR';
    document.title = english ? pageTitleEn : pageTitlePt;
    if (description) description.content = english ? descriptionEn : descriptionPt;
    languageButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.lang === language)));
    const navToggle = document.querySelector('.nav-toggle');
    if (navToggle) navToggle.setAttribute('aria-label', english ? 'Open menu' : 'Abrir menu');
    const skip = document.querySelector('.skip');
    if (skip) skip.setAttribute('aria-label', english ? 'Skip to content' : 'Ir para o conteúdo');
  };
  const updateLanguage = (language) => {
    window.clearTimeout(languageSwapTimer);
    if (reduce) {
      applyLanguage(language);
      return;
    }
    document.documentElement.classList.add('lang-swap');
    languageSwapTimer = window.setTimeout(() => {
      applyLanguage(language);
      window.requestAnimationFrame(() => {
        document.documentElement.classList.remove('lang-swap');
      });
    }, 320);
  };
  languageButtons.forEach((button) => {
    button.addEventListener('click', () => updateLanguage(button.dataset.lang));
  });
})();
