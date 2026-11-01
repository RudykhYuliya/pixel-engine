// Движок пиксельной графики для мультиков и игр.
//
// Приемы, которые он умеет, взяты не из одного стиля, а из того,
// что повторяют разные авторы:
//
// - Saultoons / MakeBead, "How to Make Pixel Art" (2026):
//   https://makebead.com/how-to-make-pixel-art/
//   Силуэт, плоский цвет, потом свет. Сдвиг оттенка: тень к сине-фиолетовому,
//   свет к желтому. Контур бывает черным, темным, цветом области, светлым
//   со стороны лампы, рваным (дырка там, где свет) или его нет.
//   Кластеры вместо одиноких пикселей. Одинокий пиксель только как глаз или блик.
//
// - Pedro Medeiros (Saint11), Celeste, "Basic Shading" и "Anti-alias":
//   https://saint11.art/pixel_art_articles/article4/
//   https://saint11.art/pixel_art_articles/article5/
//   Плоская грань - один цвет. Круглое - ступени рампы по направлению света.
//   Терминатор резкий. Тень падает пятном. Блик маленький.
//   Свет отскока - узкая полоска в тени у земли. Подушечное затенение
//   (темный ободок со всех сторон) не делаем.
//   Антиалиас только на ступеньке длиннее 1 пикселя, полутоном,
//   и не на диагонали 1:1. Иначе это вторая линия, banding.
//
// - Pixeli, вода и дизер:
//   https://pixeli.pebbly.space/knowledge/rules/64-water
//   https://pixeli.pebbly.space/knowledge/rules/13-dithering-and-texture
//   Отражение короче примерно на четверть, на шаг темнее, уведено в цвет воды.
//   Режется на полоски и сдвигается через ряд на 1 пиксель.
//   Нижняя треть редеет шахматой. Дизер только между соседними ступенями рампы,
//   на шве, не на лице и не на том, что каждый кадр двигается.
//
// Цвет везде [r, g, b], 0..255. Координаты целые, камера тоже в целых пикселях.
(function (global) {
  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function hex(value) {
    const h = value.replace("#", "");
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r = 0;
    let g = 0;
    let b = 0;
    if (hp < 1) { r = c; g = x; }
    else if (hp < 2) { r = x; g = c; }
    else if (hp < 3) { g = c; b = x; }
    else if (hp < 4) { g = x; b = c; }
    else if (hp < 5) { r = x; b = c; }
    else { r = c; b = x; }
    const m = l - c / 2;
    return [
      clamp(Math.round((r + m) * 255), 0, 255),
      clamp(Math.round((g + m) * 255), 0, 255),
      clamp(Math.round((b + m) * 255), 0, 255),
    ];
  }

  function mix(a, b, t) {
    return [
      clamp(Math.round(a[0] + (b[0] - a[0]) * t), 0, 255),
      clamp(Math.round(a[1] + (b[1] - a[1]) * t), 0, 255),
      clamp(Math.round(a[2] + (b[2] - a[2]) * t), 0, 255),
    ];
  }

  // Средняя ступень - сам цвет.
  // Тень темнеет и подмешивает shadowHue, свет идет к теплому lightHue.
  // Оттенок не едет по кругу: иначе желтый по пути становится красным.
  function ramp(base, opt) {
    const options = opt || {};
    const steps = options.steps || 5;
    const src = typeof base === "string" ? hex(base) : base;
    const shadowHue = options.shadowHue == null ? 232 : options.shadowHue;
    const lightHue = options.lightHue == null ? 42 : options.lightHue;
    const shadowTint = hslToRgb(shadowHue, 0.38, 0.32);
    const lightTint = hslToRgb(lightHue, 0.42, 0.94);
    const mid = (steps - 1) / 2;
    const colors = [];
    for (let i = 0; i < steps; i++) {
      const t = mid === 0 ? 0 : (i - mid) / mid;
      if (t < 0) {
        const k = -t;
        const darkened = [
          src[0] * (1 - 0.78 * k),
          src[1] * (1 - 0.8 * k),
          src[2] * (1 - 0.7 * k),
        ];
        colors.push(mix(darkened, shadowTint, 0.48 * k));
      } else if (t > 0) {
        colors.push(mix(src, lightTint, t * 0.8));
      } else {
        colors.push([src[0], src[1], src[2]]);
      }
    }
    return colors;
  }

  function darken(color, amount) {
    const k = amount == null ? 0.45 : amount;
    return [
      clamp(Math.round(color[0] * (1 - 0.72 * k)), 0, 255),
      clamp(Math.round(color[1] * (1 - 0.78 * k)), 0, 255),
      clamp(Math.round(color[2] * (1 - 0.5 * k) + 16 * k), 0, 255),
    ];
  }

  function lighten(color, amount) {
    const k = amount == null ? 0.4 : amount;
    return mix(color, [255, 236, 206], k);
  }

  function sprite(rows, map) {
    const h = rows.length;
    const w = rows[0].length;
    const pixels = new Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = rows[y][x];
        pixels[y * w + x] = ch === "." || ch === " " ? null : (map[ch] || null);
      }
    }
    return {
      w: w,
      h: h,
      at: function (x, y) {
        if (x < 0 || y < 0 || x >= w || y >= h) return null;
        return pixels[y * w + x];
      },
    };
  }

  function mount(canvas, width, height) {
    const w = width;
    const h = height;
    canvas.width = w;
    canvas.height = h;
    const ctx2d = canvas.getContext("2d", { alpha: false });
    ctx2d.imageSmoothingEnabled = false;
    const image = ctx2d.createImageData(w, h);
    const data = image.data;
    const solid = new Uint8Array(w * h);
    const keys = {};
    let camX = 0;
    let camY = 0;
    let raf = 0;
    let running = false;
    let stamp = 1;
    const api = {
      w: w,
      h: h,
      keys: keys,
      time: 0,
      dt: 0,
    };

    function idx(x, y) {
      return y * w + x;
    }

    function plot(x, y, color) {
      x = (x - camX) | 0;
      y = (y - camY) | 0;
      if (x < 0 || y < 0 || x >= w || y >= h || !color) return;
      const i = idx(x, y);
      const p = i * 4;
      data[p] = color[0];
      data[p + 1] = color[1];
      data[p + 2] = color[2];
      data[p + 3] = 255;
      solid[i] = stamp;
    }

    function get(x, y) {
      x = (x - camX) | 0;
      y = (y - camY) | 0;
      if (x < 0 || y < 0 || x >= w || y >= h) return null;
      const i = idx(x, y);
      if (!solid[i]) return null;
      const p = i * 4;
      return [data[p], data[p + 1], data[p + 2]];
    }

    function cls(color) {
      const c = color || [0, 0, 0];
      stamp = 1;
      solid.fill(0);
      for (let i = 0; i < w * h; i++) {
        const p = i * 4;
        data[p] = c[0];
        data[p + 1] = c[1];
        data[p + 2] = c[2];
        data[p + 3] = 255;
      }
    }

    // Все, что нарисовано после mark, - отдельный слой.
    // reflect берет только его, поэтому небо и земля в воду не попадают.
    function mark() {
      stamp++;
      if (stamp > 250) stamp = 2;
    }

    function rect(x, y, rw, rh, color) {
      const x0 = x | 0;
      const y0 = y | 0;
      const x1 = (x + rw) | 0;
      const y1 = (y + rh) | 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) plot(xx, yy, color);
      }
    }

    function line(x0, y0, x1, y1, color) {
      let ix0 = x0 | 0;
      let iy0 = y0 | 0;
      const ix1 = x1 | 0;
      const iy1 = y1 | 0;
      const dx = Math.abs(ix1 - ix0);
      const dy = Math.abs(iy1 - iy0);
      const sx = ix0 < ix1 ? 1 : -1;
      const sy = iy0 < iy1 ? 1 : -1;
      let err = dx - dy;
      for (;;) {
        plot(ix0, iy0, color);
        if (ix0 === ix1 && iy0 === iy1) break;
        const e2 = err * 2;
        if (e2 > -dy) { err -= dy; ix0 += sx; }
        if (e2 < dx) { err += dx; iy0 += sy; }
      }
    }

    function tri(ax, ay, bx, by, cx, cy, color) {
      let minX = Math.floor(Math.min(ax, bx, cx));
      let maxX = Math.ceil(Math.max(ax, bx, cx));
      let minY = Math.floor(Math.min(ay, by, cy));
      let maxY = Math.ceil(Math.max(ay, by, cy));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const e0 = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
          const e1 = (x - bx) * (cy - by) - (y - by) * (cx - bx);
          const e2 = (x - cx) * (ay - cy) - (y - cy) * (ax - cx);
          if ((e0 >= 0 && e1 >= 0 && e2 >= 0) || (e0 <= 0 && e1 <= 0 && e2 <= 0)) {
            plot(x, y, color);
          }
        }
      }
    }

    // Ступеньки длиннее одного пикселя получают один полутон на конце.
    // Диагональ 1:1 не трогаем: там антиалиас становится второй линией.
    function ellipse(cx, cy, rx, ry, color, opt) {
      const options = opt || {};
      const light = options.light || { x: -0.7, y: -0.75 };
      const x0 = Math.floor(cx - rx - 2);
      const x1 = Math.ceil(cx + rx + 2);
      const y0 = Math.floor(cy - ry - 2);
      const y1 = Math.ceil(cy + ry + 2);
      const edge = [];
      for (let y = y0; y <= y1; y++) {
        let run = 0;
        let runStart = 0;
        for (let x = x0; x <= x1; x++) {
          const nx = (x + 0.5 - cx) / rx;
          const ny = (y + 0.5 - cy) / ry;
          const d = nx * nx + ny * ny;
          if (d <= 1) {
            plot(x, y, color);
            if (run === 0) runStart = x;
            run++;
          } else {
            if (options.aa && run >= 2 && options.aaColor) {
              plot(runStart - 1, y, options.aaColor);
              plot(x, y, options.aaColor);
            }
            run = 0;
          }
          const rim = 1 + 1.6 / Math.max(rx, ry);
          if (options.outline && options.outline !== "none" && d > 1 && d < rim * rim) {
            edge.push([x, y, nx, ny]);
          }
        }
        if (options.aa && run >= 2 && options.aaColor) {
          plot(runStart - 1, y, options.aaColor);
          plot(x1 + 1, y, options.aaColor);
        }
      }
      if (!options.outline || options.outline === "none") return;
      const ink = options.ink || [18, 12, 28];
      for (let i = 0; i < edge.length; i++) {
        const px = edge[i][0];
        const py = edge[i][1];
        const side = edge[i][2] * light.x + edge[i][3] * light.y;
        if (options.outline === "broken" && side > 0.15) continue;
        let col = darken(ink, 0.2);
        if (options.outline === "black") col = [12, 8, 18];
        else if (options.outline === "lit" || options.outline === "broken") {
          col = side > 0 ? lighten(ink, 0.55) : darken(ink, 0.35);
        } else if (options.outline === "area") col = darken(color, 0.5);
        plot(px, py, col);
      }
    }

    // Круг по рампе. Свет с одной стороны, терминатор резкий.
    // В тени снизу полоска отскока. Блик - кластер, не точка.
    // Край со стороны света не темнее середины: это и есть отказ от подушки.
    function orb(cx, cy, r, colors, opt) {
      const options = opt || {};
      const light = options.light || { x: -0.65, y: -0.75 };
      const len = Math.hypot(light.x, light.y) || 1;
      const lx = light.x / len;
      const ly = light.y / len;
      const last = colors.length - 1;
      const mid = last >> 1;
      const x0 = Math.floor(cx - r - 2);
      const x1 = Math.ceil(cx + r + 2);
      const y0 = Math.floor(cy - r - 2);
      const y1 = Math.ceil(cy + r + 2);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const nx = (x + 0.5 - cx) / r;
          const ny = (y + 0.5 - cy) / r;
          const d2 = nx * nx + ny * ny;
          if (d2 > 1) continue;
          const nd = nx * lx + ny * ly;
          let step = mid;
          if (nd > 0.58) step = last;
          else if (nd > 0.12) step = Math.min(last, mid + 1);
          else if (nd > -0.08) step = mid;
          else if (nd > -0.55) step = Math.max(0, mid - 1);
          else step = Math.max(0, mid - 2);
          if (nd < -0.12 && ny > 0.4) step = Math.min(mid, step + 1);
          plot(x, y, colors[step]);
        }
      }
      const hx = Math.round(cx + lx * r * 0.55);
      const hy = Math.round(cy + ly * r * 0.55);
      plot(hx, hy, colors[last]);
      plot(hx + 1, hy, colors[last]);
      plot(hx, hy + 1, colors[Math.max(0, last - 1)]);
      if (!options.outline || options.outline === "none") return;
      const ink = options.ink || colors[0];
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const nx = (x + 0.5 - cx) / r;
          const ny = (y + 0.5 - cy) / r;
          const d2 = nx * nx + ny * ny;
          const limit = 1 + 2.2 / r;
          if (d2 <= 1 || d2 > limit * limit) continue;
          const side = nx * lx + ny * ly;
          if (options.outline === "broken" && side > 0.05) continue;
          const col = side > 0 ? lighten(ink, 0.35) : colors[0];
          plot(x, y, col);
        }
      }
    }

    // Bayer 4x4. amount 0 - только a, 1 - только b.
    // Соседние ступени рампы. Не класть на лицо и на бегущий спрайт.
    function dither(x, y, rw, rh, a, b, amount) {
      const amt = amount == null ? 0.5 : amount;
      const x0 = x | 0;
      const y0 = y | 0;
      const bayer = [
        0, 8, 2, 10,
        12, 4, 14, 6,
        3, 11, 1, 9,
        15, 7, 13, 5,
      ];
      for (let yy = 0; yy < rh; yy++) {
        for (let xx = 0; xx < rw; xx++) {
          const cell = bayer[(yy & 3) * 4 + (xx & 3)] / 16;
          plot(x0 + xx, y0 + yy, cell < amt ? b : a);
        }
      }
    }

    // Небо и земля полосами рампы.
    // seam: true добавляет один ряд дизера между полосами.
    // На широком небе этот ряд читается как пунктир, поэтому по умолчанию шов выключен.
    function bands(x, y, rw, rh, colors, opt) {
      const seam = !!(opt && opt.seam);
      const rows = colors.length;
      const bandH = Math.max(1, Math.floor(rh / rows));
      for (let i = 0; i < rows; i++) {
        const y0 = y + i * bandH;
        const hh = i === rows - 1 ? y + rh - y0 : bandH;
        rect(x, y0, rw, hh, colors[i]);
        if (seam && i < rows - 1) {
          dither(x, y0 + hh - 1, rw, 1, colors[i], colors[i + 1], 0.5);
        }
      }
    }

    function blit(sp, x, y, opt) {
      const options = opt || {};
      const light = options.light || { x: -1, y: -1 };
      const mode = options.outline || "none";
      if (mode !== "none") {
        const ink = options.ink || [22, 14, 32];
        for (let sy = 0; sy < sp.h; sy++) {
          for (let sx = 0; sx < sp.w; sx++) {
            if (!sp.at(sx, sy)) continue;
            const nbs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (let k = 0; k < 4; k++) {
              const ox = nbs[k][0];
              const oy = nbs[k][1];
              if (sp.at(sx + ox, sy + oy)) continue;
              const side = ox * light.x + oy * light.y;
              if (mode === "broken" && side > 0) continue;
              let col = darken(ink, 0.25);
              if (mode === "black") col = [10, 8, 16];
              else if (mode === "lit" || mode === "broken") col = side > 0 ? lighten(ink, 0.7) : darken(ink, 0.4);
              else if (mode === "area") col = darken(sp.at(sx, sy), 0.55);
              plot(x + sx + ox, y + sy + oy, col);
            }
          }
        }
      }
      for (let sy = 0; sy < sp.h; sy++) {
        for (let sx = 0; sx < sp.w; sx++) {
          const color = sp.at(sx, sy);
          if (color) plot(x + sx, y + sy, color);
        }
      }
    }

    // Падающая тень: плоское пятно, не ореол вокруг объекта.
    function shadow(x, y, rx, color) {
      ellipse(x, y, rx, Math.max(1, rx * 0.35), color || [8, 6, 16]);
    }

    function layerAt(x, y) {
      const sx = (x - camX) | 0;
      const sy = (y - camY) | 0;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) return 0;
      return solid[idx(sx, sy)];
    }

    // Отражение слоя, нарисованного после последнего mark.
    // Короче примерно на четверть, темнее, в цвет воды.
    // Полоски через ряд сдвигаются на пиксель, нижняя треть редеет.
    // ground - линия земли: объект зеркалится через нее.
    // Без ground отражение кладется сразу под прямоугольник (ноги у воды).
    function reflect(rect, opt) {
      const options = opt || {};
      const water = options.water || [16, 28, 58];
      const shorten = options.shorten == null ? 0.75 : options.shorten;
      const time = options.time || 0;
      const frame = Math.floor(time * 5);
      const layer = stamp;
      const saved = [];
      for (let yy = 0; yy < rect.h; yy++) {
        for (let xx = 0; xx < rect.w; xx++) {
          const wx = rect.x + xx;
          const wy = rect.y + yy;
          if (layerAt(wx, wy) !== layer) continue;
          const src = get(wx, wy);
          if (src) saved.push([wx, wy, src]);
        }
      }
      if (!saved.length) return;
      if (options.ground == null) {
        const dstH = Math.max(1, Math.round(rect.h * shorten));
        for (let i = 0; i < saved.length; i++) {
          const wx = saved[i][0];
          const wy = saved[i][1];
          const src = saved[i][2];
          const fromBottom = rect.y + rect.h - 1 - wy;
          const dy = Math.round(fromBottom * shorten);
          if (dy < 0 || dy >= dstH) continue;
          const fade = dy > dstH * 0.66;
          if (fade && ((wx + dy) & 1) === 0) continue;
          const dx = wx + (((dy + frame) & 1) === 0 ? 1 : -1);
          const py = rect.y + rect.h + dy;
          if (options.clip && !options.clip(dx, py)) continue;
          plot(dx, py, mix(darken(src, 0.5), water, 0.42));
        }
        return;
      }
      const ground = options.ground;
      let maxAbove = 1;
      for (let i = 0; i < saved.length; i++) {
        const above = ground - saved[i][1];
        if (above > maxAbove) maxAbove = above;
      }
      const limit = maxAbove * shorten;
      for (let i = 0; i < saved.length; i++) {
        const wx = saved[i][0];
        const wy = saved[i][1];
        const src = saved[i][2];
        const above = ground - wy;
        if (above <= 0) continue;
        const dy = Math.round(above * shorten);
        if (dy > limit) continue;
        const fade = dy > limit * 0.66;
        if (fade && ((wx + dy) & 1) === 0) continue;
        const dx = wx + (((dy + frame) & 1) === 0 ? 1 : -1);
        const py = ground + dy;
        if (options.clip && !options.clip(dx, py)) continue;
        plot(dx, py, mix(darken(src, 0.5), water, 0.42));
      }
    }

    function present() {
      ctx2d.putImageData(image, 0, 0);
    }

    function start(draw) {
      if (running) return;
      running = true;
      let last = performance.now();
      function loop(now) {
        if (!running) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        api.time += dt;
        api.dt = dt;
        draw(dt, api.time);
        present();
        raf = requestAnimationFrame(loop);
      }
      raf = requestAnimationFrame(loop);
    }

    function stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
    }

    window.addEventListener("keydown", function (e) {
      keys[e.code] = true;
      if (e.code === "Space" || e.code.indexOf("Arrow") === 0) e.preventDefault();
    });
    window.addEventListener("keyup", function (e) {
      keys[e.code] = false;
    });

    api.cls = cls;
    api.mark = mark;
    api.plot = plot;
    api.get = get;
    api.rect = rect;
    api.line = line;
    api.tri = tri;
    api.ellipse = ellipse;
    api.orb = orb;
    api.dither = dither;
    api.bands = bands;
    api.blit = blit;
    api.shadow = shadow;
    api.reflect = reflect;
    api.present = present;
    api.start = start;
    api.stop = stop;
    api.cam = function (x, y) {
      camX = x | 0;
      camY = y | 0;
    };
    api.ramp = ramp;
    api.darken = darken;
    api.lighten = lighten;
    api.mix = mix;
    return api;
  }

  global.Pixel = {
    mount: mount,
    ramp: ramp,
    sprite: sprite,
    hex: hex,
    darken: darken,
    lighten: lighten,
    mix: mix,
  };
})(window);
