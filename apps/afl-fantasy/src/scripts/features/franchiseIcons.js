// Fix Franchise Icons - removes "_icon" from image URLs and preloads replacements
export function fixFranchiseIcons(scope = document, options = {}) {
  if (!scope) return;
  const icons = scope.querySelectorAll('img.franchiseicon');
  const applyStyles = (img) => {
    if (options.imageStyles) {
      Object.entries(options.imageStyles).forEach(([prop, value]) => {
        img.style[prop] = value;
      });
    }
  };

  icons.forEach((img) => {
    applyStyles(img);
    const newSrc = img.src.replace('/icons/', '/banners/');

    if (img.src !== newSrc) {
      const preload = new Image();
      preload.src = newSrc;

      preload.onload = () => {
        img.style.transition = 'opacity 0.2s ease-in-out';
        img.style.opacity = '0';

        setTimeout(() => {
          img.src = newSrc;
          img.style.opacity = '1';
        }, 150);
      };
    }
  });
}
