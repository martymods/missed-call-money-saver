(function installAdaEmbedGuard() {
  if (typeof window === 'undefined') {
    return;
  }
  if (window.__ADA_EMBED_GUARD_INSTALLED__) {
    return;
  }
  window.__ADA_EMBED_GUARD_INSTALLED__ = true;

  const wrappedCache = new WeakMap();

  function wrapAdaEmbed(fn) {
    if (typeof fn !== 'function') {
      return fn;
    }
    if (wrappedCache.has(fn)) {
      return wrappedCache.get(fn);
    }

    let started = false;

    const wrapped = function adaEmbedGuarded() {
      const args = Array.prototype.slice.call(arguments);
      const command = args[0];
      if (command === 'start') {
        if (started) {
          console.warn('Ada Embed has already been started. Ignoring duplicate start command.');
          return;
        }
        started = true;
      }
      return fn.apply(this, args);
    };

    try {
      Object.assign(wrapped, fn);
    } catch (error) {
      // Ignore non-assignable properties
    }

    if (typeof fn.q !== 'undefined') {
      wrapped.q = fn.q;
    }

    wrappedCache.set(fn, wrapped);
    return wrapped;
  }

  const descriptor = Object.getOwnPropertyDescriptor(window, 'AdaEmbed');

  if (!descriptor || descriptor.configurable) {
    let internal = wrapAdaEmbed(window.AdaEmbed);
    Object.defineProperty(window, 'AdaEmbed', {
      configurable: true,
      enumerable: true,
      get() {
        return internal;
      },
      set(value) {
        internal = wrapAdaEmbed(value);
      },
    });
  } else if ('value' in descriptor && descriptor.writable && typeof window.AdaEmbed === 'function') {
    window.AdaEmbed = wrapAdaEmbed(window.AdaEmbed);
  }
})();
