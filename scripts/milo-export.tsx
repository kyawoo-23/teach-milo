import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import { MiloArtwork } from "../src/components/milo-artwork";
import {
  animateMiloTimeline,
  MILO_MOTIONS,
  type MiloState,
} from "../src/components/milo-motion";

async function main() {
  const output = path.resolve(__dirname, "../public/milo");
  const fps = 12;
  const cell = 256;
  const columns = 8;
  const states = Object.keys(MILO_MOTIONS) as MiloState[];
  const player = animateMiloTimeline.toString();
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: columns * cell, height: 2400 },
    deviceScaleFactor: 1,
  });
  const sheets: Record<string, unknown> = {};
  const contactRows: string[] = [];
  await mkdir(output, { recursive: true });

  try {
    for (const state of states) {
      const motion = MILO_MOTIONS[state];
      const count =
        Math.ceil((motion.duration * fps) / 1000) + (motion.loop ? 0 : 1);
      const frames = Array.from({ length: count }, (_, i) => ({
        x: (i % columns) * cell,
        y: Math.floor(i / columns) * cell,
        time: Math.min((i * 1000) / fps, motion.duration),
      }));
      const height = Math.ceil(count / columns) * cell;
      // Render together so React useId produces distinct gradients in every cell.
      const artwork = renderToStaticMarkup(
        <>
          {frames.map((_, i) => (
            <MiloArtwork key={i} size={cell} state={state} decorative />
          ))}
        </>,
      );
      await page.setContent(
        `<!doctype html><style>html,body{margin:0;background:transparent}#sheet{display:grid;grid-template-columns:repeat(${columns},${cell}px);width:${columns * cell}px;height:${height}px}svg{display:block}</style><div id="sheet">${artwork}</div>`,
      );
      await page.evaluate(
        ({ motion, frames, player }) => {
          const animate = new Function(
            `return (${player})`,
          )() as typeof animateMiloTimeline;
          document.querySelectorAll<SVGSVGElement>("svg").forEach((svg, i) => {
            animate(svg, motion).forEach((animation) => {
              animation.pause();
              animation.currentTime = frames[i].time;
            });
          });
        },
        { motion, frames, player },
      );
      if (motion.parts.blink) {
        const scales = await page
          .locator('[data-milo-part="blink"]')
          .evaluateAll((eyes) =>
            eyes.map((eye) => new DOMMatrix(getComputedStyle(eye).transform).d),
          );
        if (Math.min(...scales) > 0.15 || Math.max(...scales) < 0.99) {
          throw new Error(
            `${state}: sampled blink must close and reopen the eyes`,
          );
        }
      }
      const png = await page
        .locator("#sheet")
        .screenshot({ omitBackground: true, animations: "allow" });
      // Validate the actual raster: transparent cells and no pixels touching edges.
      const raster = await page.evaluate(
        async ({ data, count, cell, columns }) => {
          const img = new Image();
          img.src = `data:image/png;base64,${data}`;
          await img.decode();
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          const pixels = ctx.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          ).data;
          let clipped = 0;
          let transparent = 0;
          for (let i = 0; i < count; i++) {
            const x = (i % columns) * cell,
              y = Math.floor(i / columns) * cell;
            for (let py = 0; py < cell; py++)
              for (let px = 0; px < cell; px++) {
                const alpha =
                  pixels[((y + py) * canvas.width + x + px) * 4 + 3];
                if (alpha === 0) transparent++;
                if (
                  (px === 0 ||
                    py === 0 ||
                    px === cell - 1 ||
                    py === cell - 1) &&
                  alpha > 0
                )
                  clipped++;
              }
          }
          return { clipped, transparent };
        },
        { data: png.toString("base64"), count, cell, columns },
      );
      if (raster.clipped || !raster.transparent)
        throw new Error(
          `${state}: invalid alpha or clipped frames (${JSON.stringify(raster)})`,
        );
      await writeFile(path.join(output, `${state}.png`), png);
      sheets[state] = {
        file: `${state}.png`,
        width: columns * cell,
        height,
        frameWidth: cell,
        frameHeight: cell,
        columns,
        fps,
        duration: motion.duration,
        loop: motion.loop,
        frameCount: count,
        frames,
      };
      const samples = Array.from({ length: 8 }, (_, i) =>
        Math.min(Math.round((i * (count - 1)) / 7), count - 1),
      );
      contactRows.push(
        `<section><h2>${state} · ${motion.duration}ms · ${motion.loop ? "loop" : "once"}</h2><div class="samples">${samples.map((i) => `<figure><div style="background-image:url(data:image/png;base64,${png.toString("base64")});background-position:-${frames[i].x / 2}px -${frames[i].y / 2}px;background-size:${(columns * cell) / 2}px ${height / 2}px"></div><figcaption>${Math.round(frames[i].time)}ms</figcaption></figure>`).join("")}</div></section>`,
      );
      process.stdout.write(
        `${state}: ${count} frames, transparent, no clipping\n`,
      );
    }
    await writeFile(
      path.join(output, "metadata.json"),
      JSON.stringify(
        {
          version: 1,
          source: "Milo SVG and shared Web Animations timelines",
          sheets,
        },
        null,
        2,
      ) + "\n",
    );
    await page.setContent(
      `<!doctype html><style>body{margin:0;padding:24px;background:#f8f6fe;color:#31355e;font:14px system-ui}h1{margin:0 0 20px}h2{font-size:15px;margin:16px 0 4px}.samples{display:flex}figure{margin:0}figure>div{width:128px;height:128px}figcaption{text-align:center;font-size:11px}</style><main><h1>Milo motion · original SVG · 12 fps</h1>${contactRows.join("")}</main>`,
    );
    await page.setViewportSize({ width: 1072, height: 1300 });
    await page
      .locator("main")
      .screenshot({ path: path.join(output, "contact-sheet.png") });
    // Embedded metadata lets the preview open directly from disk without a server.
    const cards = states
      .map(
        (state) =>
          `<article><h2>${state}</h2><div class="sprite" data-state="${state}" role="img" aria-label="Milo ${state}"></div><button type="button" data-replay="${state}">Replay ${state}</button></article>`,
      )
      .join("");
    const preview = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Milo motion preview</title>
<style>body{margin:0;padding:clamp(16px,4vw,32px);background:#f8f6fe;color:#31355e;font:16px system-ui}header{max-width:760px;margin:auto}h1{font-size:32px}main{max-width:1000px;margin:24px auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}article{text-align:center;border:1px solid #dcd8ef;border-radius:20px;padding:12px;background:#fff}h2{text-transform:capitalize;font-size:18px}.sprite{width:256px;height:256px;margin:auto}button{padding:10px 16px;background:#eeecfa;color:#31355e;border:1px solid #dcd8ef;border-radius:12px;cursor:pointer}button:focus-visible{outline:2px solid #655dcc;outline-offset:3px}</style>
<header><h1>Milo is ready to move.</h1><p>Original vector artwork, sampled at 12 frames per second. Tap a replay button to try each reaction.</p><button id="pause" type="button">Pause motion</button></header><main>${cards}</main>
<script>
const sheets=${JSON.stringify(sheets)};
const preference=matchMedia('(prefers-reduced-motion: reduce)');
let paused=false, previous=0;
const sprites=[...document.querySelectorAll('.sprite')].map(element=>{const state=element.dataset.state,sheet=sheets[state];element.style.backgroundImage='url('+sheet.file+')';return {element,state,sheet,elapsed:0};});
function draw(sprite){const s=sprite.sheet;const time=s.loop?sprite.elapsed%s.duration:Math.min(sprite.elapsed,s.duration);const index=!s.loop&&time>=s.duration?s.frameCount-1:Math.min(Math.floor(time*s.fps/1000),s.frameCount-1);const frame=s.frames[index];sprite.element.style.backgroundPosition=(-frame.x)+'px '+(-frame.y)+'px';}
sprites.forEach(draw);
document.querySelectorAll('[data-replay]').forEach(button=>button.addEventListener('click',()=>{const sprite=sprites.find(s=>s.state===button.dataset.replay);sprite.elapsed=0;draw(sprite);}));
document.querySelector('#pause').addEventListener('click',event=>{paused=!paused;event.currentTarget.textContent=paused?'Resume motion':'Pause motion';});
function tick(now){const delta=previous?Math.min(now-previous,100):0;previous=now;if(!paused&&!preference.matches&&!document.hidden)sprites.forEach(sprite=>{sprite.elapsed+=delta;draw(sprite);});requestAnimationFrame(tick);}requestAnimationFrame(tick);
</script></html>`;
    await writeFile(path.join(output, "preview.html"), preview);
    await writeFile(
      path.join(output, "README.md"),
      "# Milo sprite sheets\n\nRun `pnpm milo:export` to regenerate from the original SVG and shared motion timelines. Open `preview.html` locally to play every state.\n\nPNG sheets have transparent backgrounds, 256 × 256 cells, eight columns, and 12 fps. `metadata.json` gives exact frame positions and sample times; unused final cells are transparent. Non-looping sheets include the final pose. Use the metadata duration for loop timing. The app animates the SVG directly.\n",
    );
  } finally {
    await browser.close();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
