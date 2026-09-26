'use strict';

/**
 * Photographs of a consignment, and customers' requests for one.
 *
 * Anyone holding a tracking number can ask to see the cargo; the desk takes a
 * picture, uploads it against the consignment, and it appears on the tracking
 * page for everyone holding the number — the same people who could already
 * see everything else there. Whoever asked and left an address is told.
 *
 * Supabase in production: the images in a public Storage bucket under random
 * names, the rows in shipment_photos and photo_requests (0006_photos.sql).
 * Without Supabase, JSON files under DATA_DIR with the image inline as a data
 * URL, so the whole loop runs locally with nothing installed.
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const { dataDir } = require('./paths');
const { getSupabase } = require('./supabase');
const { isMissingTable } = require('./shipmentStore');

const BUCKET = 'consignment-photos';
const PHOTOS = 'shipment_photos';
const REQUESTS = 'photo_requests';
const PHOTOS_FILE = 'photos.json';
const REQUESTS_FILE = 'photo_requests.json';

/** Decoded size cap. The desk resizes before sending, so this is generous. */
const MAX_BYTES = 3 * 1024 * 1024;
/** Enough to show the cargo from every side; not a gallery. */
const MAX_PER_SHIPMENT = 12;
/** Open requests one consignment may carry before more are folded in. */
const MAX_OPEN_REQUESTS = 5;

const MIGRATION = 'supabase/migrations/0006_photos.sql';
const nowIso = () => new Date().toISOString();

/** An error the controllers turn into a status and a sentence. */
class PhotoError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const unavailable = () =>
  new PhotoError(
    'photos_unavailable',
    `Consignment photos are not set up on this database yet. Run ${MIGRATION} in the Supabase SQL editor.`,
    503
  );

/* --------------------------------------------------------------- images --- */

/** What the bytes actually are, whatever the upload claimed. */
function sniff(buffer) {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { type: 'image/jpeg', ext: 'jpg' };
  }
  if (buffer.length > 8 && buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { type: 'image/png', ext: 'png' };
  }
  if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { type: 'image/webp', ext: 'webp' };
  }
  return null;
}

/**
 * A data URL from the desk, as bytes.
 *
 * The type is read from the bytes rather than trusted from the prefix, so an
 * SVG or HTML file renamed .jpg cannot end up served from our bucket.
 */
function decodeImage(dataUrl) {
  const match = /^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!match) throw new PhotoError('invalid_image', 'Attach a photo: a JPEG, PNG or WebP image.');
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length) throw new PhotoError('invalid_image', 'That photo is empty.');
  if (buffer.length > MAX_BYTES) {
    throw new PhotoError('image_too_large', `That photo is ${(buffer.length / 1048576).toFixed(1)} MB; the limit is ${MAX_BYTES / 1048576} MB.`, 413);
  }
  const kind = sniff(buffer);
  if (!kind) throw new PhotoError('invalid_image', 'That file is not a JPEG, PNG or WebP image.');
  return { buffer, ...kind };
}

/* ---------------------------------------------------------------- files --- */

let writeChain = Promise.resolve();

async function readJson(name) {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(dataDir(), name), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function writeJson(name, mutate) {
  const task = writeChain.then(async () => {
    await fs.mkdir(dataDir(), { recursive: true });
    const all = await readJson(name);
    const result = await mutate(all);
    await fs.writeFile(path.join(dataDir(), name), JSON.stringify(all, null, 2), 'utf8');
    return result;
  });
  writeChain = task.catch(() => {});
  return task;
}

/** Run a Supabase call, turning "no such table" into the setup message. */
async function guarded(work) {
  try {
    return await work();
  } catch (err) {
    if (isMissingTable(err)) throw unavailable();
    throw err;
  }
}

/* --------------------------------------------------------------- photos --- */

async function listPhotos(shipmentId) {
  const supabase = getSupabase();
  if (supabase) {
    try {
      return await supabase.select(
        PHOTOS,
        `select=*&shipment_id=eq.${encodeURIComponent(shipmentId)}&order=created_at.desc&limit=${MAX_PER_SHIPMENT * 2}`
      );
    } catch (err) {
      // Reading is what every tracking lookup does; a database without the
      // table simply has no photos rather than a broken tracking page.
      if (isMissingTable(err)) return [];
      throw err;
    }
  }
  return (await readJson(PHOTOS_FILE))
    .filter((p) => p.shipment_id === shipmentId)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

async function addPhoto(shipmentId, { dataUrl, caption }) {
  const image = decodeImage(dataUrl);
  const existing = await listPhotos(shipmentId);
  if (existing.length >= MAX_PER_SHIPMENT) {
    throw new PhotoError('too_many_photos', `A consignment carries at most ${MAX_PER_SHIPMENT} photos. Remove one first.`, 409);
  }

  const id = crypto.randomUUID();
  const row = {
    id,
    shipment_id: shipmentId,
    caption: caption || null,
    content_type: image.type,
    bytes: image.buffer.length,
  };

  const supabase = getSupabase();
  if (supabase) {
    // Random, unguessable names: the bucket is public, and the only way to a
    // photo's address is through a tracking number that shows it.
    const objectPath = `${shipmentId}/${id}.${image.ext}`;
    try {
      await supabase.storageUpload(BUCKET, objectPath, image.buffer, image.type);
    } catch (err) {
      if (/bucket not found|404/i.test(err.message)) {
        throw new PhotoError(
          'bucket_missing',
          `The ${BUCKET} storage bucket does not exist yet. Run ${MIGRATION} in the Supabase SQL editor.`,
          503
        );
      }
      throw err;
    }
    try {
      const [created] = await guarded(() =>
        supabase.insertReturning(PHOTOS, { ...row, storage_path: objectPath, url: supabase.publicUrl(BUCKET, objectPath) })
      );
      return created;
    } catch (err) {
      // Do not leave an orphan in the bucket for a row that never landed.
      await supabase.storageRemove(BUCKET, [objectPath]).catch(() => {});
      throw err;
    }
  }

  return writeJson(PHOTOS_FILE, async (all) => {
    const created = {
      ...row,
      created_at: nowIso(),
      storage_path: null,
      url: `data:${image.type};base64,${image.buffer.toString('base64')}`,
    };
    all.unshift(created);
    return created;
  });
}

async function removePhoto(shipmentId, photoId) {
  const supabase = getSupabase();
  if (supabase) {
    const rows = await guarded(() =>
      supabase.select(
        PHOTOS,
        `select=*&id=eq.${encodeURIComponent(photoId)}&shipment_id=eq.${encodeURIComponent(shipmentId)}&limit=1`
      )
    );
    if (!rows.length) return false;
    await supabase.remove(PHOTOS, `id=eq.${encodeURIComponent(photoId)}`);
    if (rows[0].storage_path) {
      await supabase.storageRemove(BUCKET, [rows[0].storage_path]).catch((err) => {
        console.warn('[paramount] photo row removed but its file stayed:', err.message);
      });
    }
    return true;
  }
  return writeJson(PHOTOS_FILE, async (all) => {
    const i = all.findIndex((p) => p.id === photoId && p.shipment_id === shipmentId);
    if (i >= 0) all.splice(i, 1);
    return i >= 0;
  });
}

/* ------------------------------------------------------------- requests --- */

async function listRequests(shipmentId, { openOnly = false } = {}) {
  const supabase = getSupabase();
  if (supabase) {
    try {
      return await supabase.select(
        REQUESTS,
        `select=*&shipment_id=eq.${encodeURIComponent(shipmentId)}${openOnly ? '&status=eq.open' : ''}&order=created_at.desc&limit=50`
      );
    } catch (err) {
      if (isMissingTable(err)) return [];
      throw err;
    }
  }
  return (await readJson(REQUESTS_FILE))
    .filter((r) => r.shipment_id === shipmentId && (!openOnly || r.status === 'open'))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

/**
 * Ask for a photo.
 *
 * Asking again is not an error and not a second row: the same address asking
 * twice, or anyone asking while an anonymous request is already open, is the
 * same request. `first` says whether this opened the consignment's first open
 * request, which is when the desk is told — not on every click.
 */
async function requestPhoto(shipmentId, { email, note }) {
  const open = await listRequests(shipmentId, { openOnly: true });
  const address = email ? String(email).toLowerCase() : null;
  const same = open.find((r) => (address ? r.email === address : !r.email)) ||
    (open.length >= MAX_OPEN_REQUESTS ? open[0] : null);
  if (same) return { request: same, duplicate: true, first: false };

  const row = { shipment_id: shipmentId, email: address, note: note || null, status: 'open' };
  const supabase = getSupabase();
  if (supabase) {
    const [created] = await guarded(() => supabase.insertReturning(REQUESTS, row));
    return { request: created, duplicate: false, first: open.length === 0 };
  }
  const created = await writeJson(REQUESTS_FILE, async (all) => {
    const stored = { id: crypto.randomUUID(), created_at: nowIso(), fulfilled_at: null, ...row };
    all.unshift(stored);
    return stored;
  });
  return { request: created, duplicate: false, first: open.length === 0 };
}

/** Mark every open request on a consignment answered; returns them. */
async function fulfilRequests(shipmentId) {
  const open = await listRequests(shipmentId, { openOnly: true });
  if (!open.length) return [];
  const patch = { status: 'done', fulfilled_at: nowIso() };
  const supabase = getSupabase();
  if (supabase) {
    await guarded(() =>
      supabase.update(REQUESTS, `shipment_id=eq.${encodeURIComponent(shipmentId)}&status=eq.open`, patch)
    );
    return open;
  }
  await writeJson(REQUESTS_FILE, async (all) => {
    all.forEach((r) => {
      if (r.shipment_id === shipmentId && r.status === 'open') Object.assign(r, patch);
    });
  });
  return open;
}

/** Consignments with a request waiting, for the desk's list. */
async function openRequestShipments() {
  const supabase = getSupabase();
  if (supabase) {
    try {
      const rows = await supabase.select(REQUESTS, 'select=shipment_id&status=eq.open&limit=1000');
      return new Set(rows.map((r) => r.shipment_id));
    } catch (err) {
      if (isMissingTable(err)) return new Set();
      throw err;
    }
  }
  return new Set((await readJson(REQUESTS_FILE)).filter((r) => r.status === 'open').map((r) => r.shipment_id));
}

/* ---------------------------------------------------------------- views --- */

/**
 * What the tracking page shows: the photos, and whether one has been asked
 * for and not yet taken. Never who asked — an address left with a request is
 * for telling that person, not for everyone else holding the number.
 */
async function publicView(shipmentId) {
  const [photos, open] = await Promise.all([
    listPhotos(shipmentId),
    listRequests(shipmentId, { openOnly: true }),
  ]);
  const oldest = open.length ? open[open.length - 1] : null;
  return {
    photos: photos.map((p) => ({ id: p.id, url: p.url, caption: p.caption || null, taken_at: p.created_at })),
    photo_request: oldest ? { open: true, requested_at: oldest.created_at } : { open: false },
  };
}

module.exports = {
  BUCKET,
  MAX_BYTES,
  MAX_PER_SHIPMENT,
  PhotoError,
  sniff,
  decodeImage,
  listPhotos,
  addPhoto,
  removePhoto,
  listRequests,
  requestPhoto,
  fulfilRequests,
  openRequestShipments,
  publicView,
};
