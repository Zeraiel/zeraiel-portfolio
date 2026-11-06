(() => {
  "use strict";

  const { site: SITE, portraitPhoto: PORTRAIT_PHOTO } = window.SiteConfig;
  const { translations, labels } = window.SiteText;

  const root = document.documentElement;
  const byId = (id) => document.getElementById(id);

  const storage = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch (error) {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch (error) {
        /* ignore */
      }
    },
  };
  let language = "en";
  const languageListeners = [];
  const onLanguageChange = (listener) => languageListeners.push(listener);
  const text = () => labels[language];

  function detectLanguage() {
    const saved = storage.get("lang");
    if (saved === "ru" || saved === "en") return saved;

    const preferred = navigator.languages || [navigator.language || "en"];
    return preferred.some((code) => /^(ru|be)/i.test(code)) ? "ru" : "en";
  }

  function translatePage(lang) {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const value = translations[lang][el.dataset.i18n];
      if (value !== undefined) el.innerHTML = value;
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const value = translations[lang][el.dataset.i18nPlaceholder];
      if (value !== undefined) el.placeholder = value;
    });
  }

  function applyLanguage(lang) {
    language = lang;
    root.lang = lang;
    translatePage(lang);

    document.title = labels[lang].title;
    const description = byId("metaDescription");
    if (description)
      description.setAttribute("content", labels[lang].description);

    languageListeners.forEach((listener) => listener(lang));
  }

  function initLanguage() {
    const button = byId("langToggle");

    if (button) {
      onLanguageChange((lang) => {
        button.innerHTML =
          lang === "en"
            ? "RU <span>/</span> <b>EN</b>"
            : "<b>RU</b> <span>/</span> EN";
        button.setAttribute("aria-label", text().langSwitch);
      });

      button.addEventListener("click", () => {
        applyLanguage(language === "en" ? "ru" : "en");
        storage.set("lang", language);
      });
    }

    applyLanguage(detectLanguage());
  }

  function initTheme() {
    const toggle = byId("themeToggle");
    const themeColor = byId("themeColor");

    const currentTheme = () =>
      root.getAttribute("data-theme") === "light" ? "light" : "dark";

    function applyTheme(theme, remember) {
      root.setAttribute("data-theme", theme);
      if (toggle)
        toggle.setAttribute("aria-pressed", String(theme === "light"));
      if (themeColor)
        themeColor.setAttribute(
          "content",
          theme === "light" ? "#f3f3ed" : "#101110",
        );
      if (remember) storage.set("theme", theme);
    }

    if (toggle) {
      applyTheme(currentTheme(), false);
      toggle.addEventListener("click", () =>
        applyTheme(currentTheme() === "light" ? "dark" : "light", true),
      );
      onLanguageChange(() => toggle.setAttribute("aria-label", text().theme));
    }

    // Follow the system setting until the visitor makes their own choice.
    if (window.matchMedia) {
      const query = matchMedia("(prefers-color-scheme: light)");
      if (query.addEventListener) {
        query.addEventListener("change", (event) => {
          if (!storage.get("theme"))
            applyTheme(event.matches ? "light" : "dark", false);
        });
      }
    }
  }

  function initMenu() {
    const toggle = byId("menuToggle");
    const nav = byId("nav");
    if (!toggle || !nav) return;

    function updateLabel() {
      const open = nav.classList.contains("open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute(
        "aria-label",
        open ? text().menuClose : text().menuOpen,
      );
    }

    function close(returnFocus) {
      if (!nav.classList.contains("open")) return;
      nav.classList.remove("open");
      updateLabel();
      if (returnFocus) toggle.focus();
    }

    toggle.addEventListener("click", () => {
      nav.classList.toggle("open");
      updateLabel();
    });
    nav
      .querySelectorAll("a")
      .forEach((link) => link.addEventListener("click", () => close(false)));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close(true);
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 620) close(false);
    });

    onLanguageChange(updateLabel);
  }

  function initLinks() {
    const notSet = [];

    document.querySelectorAll("[data-contact]").forEach((el) => {
      const key = el.dataset.contact;
      const value = SITE[key];

      if (!value) {
        notSet.push(key);
        return;
      }
      el.href = key === "email" ? "mailto:" + value : value;
      el.hidden = false;
    });

    document.querySelectorAll("[data-link]").forEach((el) => {
      const value = SITE.projects[el.dataset.link];
      if (!value) return;

      el.href = value;
      el.target = "_blank";
      el.rel = "noreferrer";
      el.hidden = false;
    });
    document.querySelectorAll(".project-links").forEach((row) => {
      if (!row.querySelector("a:not([hidden])")) row.hidden = true;
    });

    if (notSet.length) {
      console.info(
        "Contact links not set yet (hidden on the page): " + notSet.join(", "),
      );
    }
  }

  function loadImage(src, className, onLoad) {
    if (!src) return;

    const image = document.createElement("img");
    image.className = className;
    image.alt = "";
    image.addEventListener("load", () => onLoad(image), { once: true });
    image.src = src;
  }

  function initPortraitPhoto() {
    const art = byId("portraitArt");
    if (!art) return;

    let hasPhoto = false;
    const updateLabel = () =>
      art.setAttribute(
        "aria-label",
        hasPhoto ? text().portrait : text().portraitArt,
      );
    onLanguageChange(updateLabel);

    loadImage(PORTRAIT_PHOTO, "portrait-photo", (photo) => {
      art.appendChild(photo);
      art.classList.add("has-photo");
      hasPhoto = true;
      updateLabel();
    });
  }

  function initProjectImages() {
    const shown = []; 

    onLanguageChange(() => {
      shown.forEach(({ image, key }) => {
        image.alt = text().projectImages[key] || "";
      });
    });

    document.querySelectorAll("[data-project]").forEach((frame) => {
      const key = frame.dataset.project;

      loadImage(
        SITE.projectImages && SITE.projectImages[key],
        "project-photo",
        (image) => {
          image.alt = text().projectImages[key] || "";
          frame.appendChild(image);
          frame.classList.add("has-image");
          shown.push({ image, key });
        },
      );
    });
  }

  function initRevealOnScroll() {
    if (typeof window.IntersectionObserver !== "function") return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("revealed");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12 },
    );

    document
      .querySelectorAll(
        ".service-card,.project-card,.about-grid,.contact-panel",
      )
      .forEach((el) => {
        el.classList.add("reveal-pending");
        observer.observe(el);
      });
  }

  function init() {
    initTheme();
    initMenu();
    initLinks();
    initPortraitPhoto();
    initProjectImages();
    initRevealOnScroll();
    initLanguage(); 
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
