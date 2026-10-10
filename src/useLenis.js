import { nextTick, onBeforeUnmount, watch } from 'vue';
import Lenis from 'lenis';

export function useLenisContainer(wrapperRef, contentRef, options = {}) {
  let lenis = null;
  let resizeObserver = null;

  function destroy() {
    resizeObserver?.disconnect();
    resizeObserver = null;
    lenis?.destroy();
    lenis = null;
  }

  async function create(wrapper, content) {
    destroy();
    await nextTick();
    if (!wrapper?.isConnected || !content?.isConnected) return;

    lenis = new Lenis({
      wrapper,
      content,
      autoRaf: true,
      duration: options.duration ?? 0.72,
      smoothWheel: true,
      syncTouch: false,
      overscroll: false,
      ...options.lenis,
    });
    if (options.onScroll) lenis.on('scroll', options.onScroll);

    resizeObserver = new ResizeObserver(() => {
      lenis?.resize();
      options.onResize?.();
    });
    resizeObserver.observe(wrapper);
    resizeObserver.observe(content);
    options.onReady?.(lenis);
  }

  watch(
    () => [wrapperRef.value, contentRef.value],
    ([wrapper, content]) => {
      if (wrapper && content) create(wrapper, content);
      else destroy();
    },
    { immediate: true, flush: 'post' },
  );

  onBeforeUnmount(destroy);

  return {
    resize: () => lenis?.resize(),
    scrollTo: (target, scrollOptions) => lenis?.scrollTo(target, scrollOptions),
    getInstance: () => lenis,
  };
}
