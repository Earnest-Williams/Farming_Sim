const originalDocument = globalThis.document;

function restoreDocument() {
  if (originalDocument === undefined) {
    delete globalThis.document;
  } else {
    globalThis.document = originalDocument;
  }
}

export async function testMenuToggleHandlesMissingDrawer() {
  globalThis.document = {
    addEventListener: () => {},
  };

  try {
    const module = await import('../main.js');
    const { initEvents, DOM } = module;

    const originalDrawer = DOM.drawer;
    const originalMenuToggle = DOM.menuToggle;

    let clickHandler;
    const setAttributeCalls = [];
    DOM.menuToggle = {
      addEventListener: (type, handler) => {
        if (type === 'click') {
          clickHandler = handler;
        }
      },
      setAttribute: (name, value) => {
        setAttributeCalls.push([name, value]);
      },
    };
    DOM.drawer = null;

    initEvents();

    if (typeof clickHandler !== 'function') {
      throw new Error('Menu toggle click handler was not registered');
    }

    clickHandler();

    if (setAttributeCalls.length !== 0) {
      throw new Error('aria-expanded was updated despite missing drawer');
    }

    DOM.menuToggle = originalMenuToggle;
    DOM.drawer = originalDrawer;
  } finally {
    restoreDocument();
  }
}
