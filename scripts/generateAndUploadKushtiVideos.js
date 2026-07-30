/**
 * Generate ~20s kushti demo MP4s from existing images and upload via admin API.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(__dirname, '../tmp-videos');
const API = process.env.API_URL || 'http://localhost:5000/api';

const CLIPS = [
  {
    title: 'Traditional Dab Pach Training',
    subtitle: 'Master the classic throw',
    description:
      'Authentic Dab Pach technique practice in the mitti — balance, grip, and decisive finish.',
    category: 'Dab Pach Techniques',
    coachName: 'Guru Raghunandan',
    isFeatured: true,
    displayOrder: 1,
    images: [
      'server/uploads/seed-gallery-action-2.png',
      'server/uploads/seed-programs-mud-hd.png',
    ],
  },
  {
    title: 'National Championship Final',
    subtitle: 'Championship intensity',
    description:
      'Highlights-style bout energy from pehlwani competition — grit, strategy, and spirit.',
    category: 'Championship Matches',
    coachName: 'Mahavir Singh',
    isFeatured: false,
    displayOrder: 2,
    images: [
      'server/uploads/seed-gallery-competition.png',
      'server/uploads/seed-gallery-action-1.png',
    ],
  },
  {
    title: 'Morning Akhada Routine',
    subtitle: 'Dawn discipline',
    description:
      'A morning kushti flow — mitti warm-up, drills, and conditioning under golden light.',
    category: 'Training Sessions',
    coachName: 'Vikram Pehlwan',
    isFeatured: false,
    displayOrder: 3,
    images: [
      'server/uploads/seed-gallery-mitti.png',
      'server/uploads/seed-programs-strength-hd.png',
    ],
  },
  {
    title: 'Coach Explains Kushti Techniques',
    subtitle: 'Guru guidance',
    description:
      'Head coach cues for traditional kushti holds — clear steps for beginners and competitors.',
    category: 'Coach Guidance',
    coachName: 'Guru Raghunandan',
    isFeatured: false,
    displayOrder: 4,
    images: [
      'client/src/assets/akhada/coaches/guru-raghunandan.png',
      'server/uploads/seed-programs-mud-hd.png',
    ],
  },
  {
    title: 'Young Champions Practice',
    subtitle: 'Next generation',
    description:
      'Youth pehlwans sharpen fundamentals, footwork, and confidence ahead of the next dangal.',
    category: 'Student Achievements',
    coachName: 'Arjun Pehlwan',
    isFeatured: false,
    displayOrder: 5,
    images: [
      'client/src/assets/akhada/coaches/arjun-pehlwan.png',
      'server/uploads/seed-gallery-yoga.png',
    ],
  },
];

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))));
  });
}

async function makeClip(clip, index) {
  const imgs = clip.images.map((rel) => path.join(ROOT, rel)).filter((p) => fs.existsSync(p));
  if (!imgs.length) throw new Error(`No images for ${clip.title}`);

  const out = path.join(OUT_DIR, `kushti-${index + 1}.mp4`);
  // Two half-clips (10s each) then concat, or single image hold with Ken Burns-ish zoom
  const img = imgs[0];
  const img2 = imgs[1] || imgs[0];

  const part1 = path.join(OUT_DIR, `p1-${index}.mp4`);
  const part2 = path.join(OUT_DIR, `p2-${index}.mp4`);
  const list = path.join(OUT_DIR, `list-${index}.txt`);

  const commonVf = 'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720';

  await run(ffmpegPath, [
    '-y',
    '-loop',
    '1',
    '-framerate',
    '30',
    '-i',
    img,
    '-t',
    '10',
    '-vf',
    commonVf,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-an',
    part1,
  ]);
  await run(ffmpegPath, [
    '-y',
    '-loop',
    '1',
    '-framerate',
    '30',
    '-i',
    img2,
    '-t',
    '10',
    '-vf',
    commonVf,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-an',
    part2,
  ]);

  fs.writeFileSync(
    list,
    `file '${part1.replace(/\\/g, '/')}'\nfile '${part2.replace(/\\/g, '/')}'\n`
  );

  await run(ffmpegPath, [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    out,
  ]);

  return out;
}

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL || 'fastrecovery26@gmail.com',
      password: process.env.ADMIN_PASSWORD || 'Admin@123456',
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || 'Login failed');
  return json.data.token;
}

async function clearOldVideos(token) {
  const res = await fetch(`${API}/admin/videos?limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  const videos = json.data?.videos || [];
  for (const v of videos) {
    await fetch(`${API}/admin/videos/${v._id || v.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log('Deleted old:', v.title);
  }
}

async function uploadClip(token, clip, filePath) {
  const form = new FormData();
  form.append('title', clip.title);
  form.append('subtitle', clip.subtitle);
  form.append('description', clip.description);
  form.append('category', clip.category);
  form.append('coachName', clip.coachName);
  form.append('displayOrder', String(clip.displayOrder));
  form.append('isFeatured', String(clip.isFeatured));
  form.append('status', 'published');
  form.append('duration', '0:20');

  const buf = fs.readFileSync(filePath);
  form.append('video', new Blob([buf], { type: 'video/mp4' }), path.basename(filePath));

  const res = await fetch(`${API}/admin/videos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || JSON.stringify(json) || 'Upload failed');
  console.log('Uploaded:', clip.title, '→', json.data?.video?.thumbnail || 'thumb ok');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('Generating 20s kushti clips...');

  const files = [];
  for (let i = 0; i < CLIPS.length; i++) {
    console.log(`Rendering ${i + 1}/${CLIPS.length}: ${CLIPS[i].title}`);
    files.push(await makeClip(CLIPS[i], i));
  }

  console.log('Logging in...');
  const token = await login();
  console.log('Replacing old videos...');
  await clearOldVideos(token);

  for (let i = 0; i < CLIPS.length; i++) {
    console.log(`Uploading ${i + 1}/${CLIPS.length}...`);
    await uploadClip(token, CLIPS[i], files[i]);
  }

  const pub = await fetch(`${API}/videos`);
  const pubJson = await pub.json();
  console.log('Public videos now:', pubJson.data?.videos?.length || 0);
  console.log('Done. Refresh the website Videos section.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
