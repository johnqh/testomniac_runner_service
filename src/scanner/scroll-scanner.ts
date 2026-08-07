import type { BrowserAdapter } from "../adapter.js";

export async function scrollAndDiscoverElements(
  page: BrowserAdapter
): Promise<number> {
  const viewportHeight = await page.evaluate<number>(() => window.innerHeight);
  const totalHeight = await page.evaluate<number>(
    () => document.body.scrollHeight
  );
  let scrolled = 0;
  let newElementsFound = 0;
  const knownCount = await page.evaluate<number>(
    (sel: unknown) => document.querySelectorAll(sel as string).length,
    'a[href], button, input, select, textarea, [role="button"], [role="link"]'
  );

  while (scrolled < totalHeight) {
    await page.evaluate<void>(
      (delta: unknown) => window.scrollBy(0, delta as number),
      viewportHeight
    );
    scrolled += viewportHeight;
    await new Promise(r => setTimeout(r, 500));

    const currentCount = await page.evaluate<number>(
      (sel: unknown) => document.querySelectorAll(sel as string).length,
      'a[href], button, input, select, textarea, [role="button"], [role="link"]'
    );
    if (currentCount > knownCount + newElementsFound) {
      newElementsFound = currentCount - knownCount;
    }
  }

  await page.evaluate<void>(() => window.scrollTo(0, 0));
  return newElementsFound;
}
