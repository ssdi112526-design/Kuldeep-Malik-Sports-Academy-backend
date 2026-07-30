import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

export function centerCropSquareToJpg(inputPath, outputPath, size = 512) {
  return new Promise((resolve, reject) => {
    if (!inputPath || !fs.existsSync(inputPath)) return resolve(null);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const cropFilter =
      `crop=min(iw\\,ih):min(iw\\,ih):(iw-min(iw\\,ih))/2:(ih-min(iw\\,ih))/2,scale=${size}:${size}`;

    ffmpeg(inputPath)
      .noAudio()
      .outputOptions(['-vf', cropFilter, '-frames:v', '1', '-q:v', '2', '-y'])
      .output(outputPath)
      .on('end', () => {
        // Some ffmpeg failures can still trigger `end` without writing output.
        // If the output file doesn't exist, let callers fall back to original.
        if (fs.existsSync(outputPath)) return resolve(outputPath);
        return resolve(null);
      })
      .on('error', (err) => reject(err))
      .run();
  });
}
