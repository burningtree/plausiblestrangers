import labelRules from '../../styles/vinyl-label.css?raw';

function imageData(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function drawVinylLabel(template: HTMLTemplateElement, canvas: HTMLCanvasElement) {
  const label = template.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
  if (!label) throw new Error('Missing vinyl label');
  const artwork = label.style.backgroundImage.match(/^url\("?(.*?)"?\)$/)?.[1];
  if (artwork) {
    const response = await fetch(artwork);
    if (!response.ok) throw new Error('Vinyl label artwork is unavailable');
    label.style.backgroundImage = `url("${await imageData(await response.blob())}")`;
  }

  const size = canvas.width;
  // In the sleeve view, the disc spans 94% of its container and the label spans 34% of the disc.
  const containerWidth = size / (0.94 * 0.34);
  const styles = getComputedStyle(document.documentElement);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <foreignObject width="${size}" height="${size}">
      <div xmlns="http://www.w3.org/1999/xhtml">
        <style><![CDATA[
          ${labelRules}
          .label-surface {
            width: ${containerWidth}px; container-type: inline-size;
            --mono: ${styles.getPropertyValue('--mono')};
            --serif: ${styles.getPropertyValue('--serif')};
          }
          .label-surface * { box-sizing: border-box; }
          .label-surface > .disc-label { display: block; width: ${size}px; }
        ]]></style>
        <div class="label-surface">${new XMLSerializer().serializeToString(label)}</div>
      </div>
    </foreignObject>
  </svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const context = canvas.getContext('2d')!;
  context.clearRect(0, 0, size, size);
  context.drawImage(image, 0, 0);
  if (!context.getImageData(size / 2, size / 3, 1, 1).data[3]) {
    throw new Error('Vinyl label could not be rendered');
  }
}
