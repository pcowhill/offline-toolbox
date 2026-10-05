#!/usr/bin/env node
/* global document */
// Generates the small, non-sensitive test fixtures in tests/fixtures/ (PDFs and images).
// They are committed, so this only needs to run when fixtures change:  npm run fixtures
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { chromium } from '@playwright/test';
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { repoRoot } from './lib/registry.mjs';

const pdfDir = path.join(repoRoot, 'tests/fixtures/pdf');
const imageDir = path.join(repoRoot, 'tests/fixtures/images');
fs.mkdirSync(pdfDir, { recursive: true });
fs.mkdirSync(imageDir, { recursive: true });

// Fixed dates keep the generated files byte-stable.
const FIXED_DATE = new Date('2024-01-01T00:00:00Z');
async function save(doc, name) {
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  doc.setProducer('Offline Toolbox fixture generator');
  doc.setCreator('Offline Toolbox fixture generator');
  const bytes = await doc.save({ useObjectStreams: false });
  fs.writeFileSync(path.join(pdfDir, name), bytes);
  console.log(`  ${name} (${bytes.length} bytes)`);
}

// --- PNG encoder (RGB or RGBA) -------------------------------------------------------------
function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(width, height, pixel, alpha = false) {
  const channels = alpha ? 4 : 3;
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  const raw = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = pixel(x, y);
      const o = y * (width * channels + 1) + 1 + x * channels;
      for (let c = 0; c < channels; c++) raw[o + c] = p[c];
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const samplePng = png(240, 160, (x, y) => [
  Math.round((x / 240) * 255),
  Math.round((y / 160) * 255),
  160,
]);
fs.writeFileSync(path.join(imageDir, 'sample.png'), samplePng);
const signaturePng = png(
  200,
  80,
  (x, y) => {
    const onCurve = Math.abs(y - (40 + 22 * Math.sin(x / 18))) < 3 && x > 10 && x < 190;
    return onCurve ? [20, 30, 120, 255] : [255, 255, 255, 0];
  },
  true,
);
fs.writeFileSync(path.join(imageDir, 'signature.png'), signaturePng);

// --- JPEGs via Chromium's canvas encoder (Node has no JPEG encoder) ----------------------------
const browser = await chromium.launch();
const page = await browser.newPage();
async function canvasJpeg(width, height, quality) {
  const dataUrl = await page.evaluate(
    ({ width, height, quality }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, '#0ea5e9');
      gradient.addColorStop(1, '#f97316');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = `hsl(${(i * 37) % 360} 70% ${40 + (i % 5) * 8}%)`;
        ctx.beginPath();
        ctx.arc((i * 97) % width, (i * 61) % height, 20 + (i % 7) * 9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(height / 6)}px sans-serif`;
      ctx.fillText('Fixture', width * 0.1, height * 0.55);
      return canvas.toDataURL('image/jpeg', quality);
    },
    { width, height, quality },
  );
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}
const sampleJpg = await canvasJpeg(640, 480, 0.9);
fs.writeFileSync(path.join(imageDir, 'sample.jpg'), sampleJpg);
const bigJpg = await canvasJpeg(2400, 1800, 0.95);
await browser.close();

console.log('Writing fixtures:');

// three-pages.pdf — different page sizes, page 3 has /Rotate 90.
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const sizes = [
    [612, 792],
    [595.28, 841.89],
    [792, 612],
  ];
  sizes.forEach(([w, h], i) => {
    const p = doc.addPage([w, h]);
    p.drawRectangle({
      x: 20,
      y: 20,
      width: w - 40,
      height: h - 40,
      borderColor: rgb(0.2, 0.3, 0.8),
      borderWidth: 3,
    });
    p.drawText(`Page ${i + 1}`, { x: 60, y: h - 140, size: 72, font, color: rgb(0.1, 0.1, 0.3) });
    p.drawText(`Fixture page ${i + 1} of 3`, { x: 60, y: h - 190, size: 18, font });
    p.drawText('TOP', { x: w / 2 - 20, y: h - 50, size: 16, font, color: rgb(0.8, 0.1, 0.1) });
  });
  doc.getPage(2).setRotation(degrees(90));
  doc.setTitle('Three page fixture');
  await save(doc, 'three-pages.pdf');
}

// second.pdf — a different document to merge in.
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  for (const label of ['Appendix A', 'Appendix B']) {
    const p = doc.addPage([612, 792]);
    p.drawText(label, { x: 72, y: 650, size: 48, font, color: rgb(0.5, 0.1, 0.1) });
  }
  await save(doc, 'second.pdf');
}

// form.pdf — AcroForm with common field types.
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([612, 792]);
  const form = doc.getForm();
  p.drawText('Registration form (fixture)', { x: 60, y: 730, size: 20, font });
  p.drawText('Full name', { x: 60, y: 680, size: 12, font });
  const name = form.createTextField('fullName');
  name.addToPage(p, { x: 160, y: 670, width: 300, height: 24 });
  p.drawText('Subscribe', { x: 60, y: 630, size: 12, font });
  const subscribe = form.createCheckBox('subscribe');
  subscribe.addToPage(p, { x: 160, y: 625, width: 18, height: 18 });
  p.drawText('Colour', { x: 60, y: 580, size: 12, font });
  const color = form.createRadioGroup('color');
  ['red', 'green', 'blue'].forEach((option, i) => {
    color.addOptionToPage(option, p, { x: 160 + i * 70, y: 575, width: 16, height: 16 });
    p.drawText(option, { x: 180 + i * 70, y: 578, size: 11, font });
  });
  p.drawText('Country', { x: 60, y: 530, size: 12, font });
  const country = form.createDropdown('country');
  country.addOptions(['Canada', 'Germany', 'Japan']);
  country.addToPage(p, { x: 160, y: 522, width: 200, height: 22 });
  p.drawText('Comments', { x: 60, y: 480, size: 12, font });
  const comments = form.createTextField('comments');
  comments.enableMultiline();
  comments.addToPage(p, { x: 160, y: 380, width: 300, height: 100 });
  await save(doc, 'form.pdf');
}

// secret.pdf — used to prove redaction removes text.
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.drawText('SECRET-12345', { x: 72, y: 700, size: 24, font });
  p1.drawText('Public information stays readable.', { x: 72, y: 500, size: 16, font });
  const p2 = doc.addPage([612, 792]);
  p2.drawText('Second page without secrets.', { x: 72, y: 700, size: 16, font });
  await save(doc, 'secret.pdf');
}

// images.pdf — a large JPEG and a PNG (Flate + soft mask), for extraction and optimisation.
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const jpg = await doc.embedJpg(bigJpg);
  const pngImage = await doc.embedPng(signaturePng);
  const p = doc.addPage([612, 792]);
  p.drawText('Embedded images fixture', { x: 60, y: 740, size: 18, font });
  p.drawImage(jpg, { x: 60, y: 300, width: 480, height: 360 });
  p.drawImage(pngImage, { x: 60, y: 150, width: 200, height: 80 });
  await save(doc, 'images.pdf');
}

// scanned.pdf — an image-only page (no text layer), like a scan.
{
  const doc = await PDFDocument.create();
  const jpg = await doc.embedJpg(sampleJpg);
  const p = doc.addPage([612, 792]);
  p.drawImage(jpg, { x: 0, y: 0, width: 612, height: 792 });
  await save(doc, 'scanned.pdf');
}

console.log('Done.');
