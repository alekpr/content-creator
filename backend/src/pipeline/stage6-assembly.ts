import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';

// Set system ffmpeg path for fluent-ffmpeg
ffmpeg.setFfmpegPath('/opt/homebrew/bin/ffmpeg');
import { ProjectModel } from '../models/Project.model.js';
import { emitProjectComplete } from '../socket/socket.handler.js';
import { env } from '../config/env.js';
import type { AssemblyConfig, AssemblyResult } from '@content-creator/shared';

// ─── Service ──────────────────────────────────────────────────────────────────

export async function assembleVideo(
  projectId: string,
  videoPaths: string[],
  voicePath: string,
  musicPath: string | null,
  config: AssemblyConfig,
  onProgress: (percent: number) => void
): Promise<AssemblyResult> {
  const tempDir = path.join(env.TEMP_DIR, projectId);
  const outputDir = env.OUTPUT_DIR;
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, `${projectId}.mp4`);
  const concatPath = path.join(tempDir, 'filelist.txt');

  // Step 1: Write concat list (use absolute paths for safety)
  const fileList = videoPaths.map(p => `file '${path.resolve(p)}'`).join('\n');
  fs.writeFileSync(concatPath, fileList);

  // Step 2: Concat video clips
  const concatOutput = path.join(tempDir, 'video_concat.mp4');
  await runFFmpeg(cmd =>
    cmd
      .input(concatPath)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy'])
      .output(concatOutput)
  );

  // Step 3: Validate audio streams exist
  await validateFileHasStream(voicePath, 'audio');
  if (musicPath) await validateFileHasStream(musicPath, 'audio');

  // Step 4: Mix video + audio
  const crf = config.outputQuality === 'high' ? '18' : '23';

  await runFFmpeg(
    cmd => {
      cmd.input(concatOutput);

      if (musicPath) {
        cmd
          .input(voicePath)
          .input(musicPath)
          .complexFilter([
            `[1:a]volume=${config.voiceVolume}:precision=fixed[voice]`,
            `[2:a]volume=${config.musicVolume}:precision=fixed[music]`,
            `[voice][music]amix=inputs=2:duration=longest[aout]`,
          ])
          .outputOptions([
            '-map 0:v:0',
            '-map [aout]',
            `-c:v libx264`,
            `-crf ${crf}`,
            '-c:a aac',
            '-movflags +faststart',
          ]);
      } else {
        cmd
          .input(voicePath)
          .complexFilter([`[1:a]volume=${config.voiceVolume}:precision=fixed[aout]`])
          .outputOptions([
            '-map 0:v:0',
            '-map [aout]',
            `-c:v libx264`,
            `-crf ${crf}`,
            '-c:a aac',
            '-movflags +faststart',
          ]);
      }

      cmd.output(outputPath);
    },
    percent => onProgress(percent)
  );

  const stats = fs.statSync(outputPath);
  const fileUrl = `/api/projects/${projectId}/download`;

  // Update MongoDB
  await ProjectModel.findByIdAndUpdate(projectId, {
    status: 'completed',
    'stages.assembly.status': 'approved',
    'stages.assembly.completedAt': new Date(),
    'stages.assembly.result': {
      outputPath,
      fileUrl,
      durationSeconds: 0,
      fileSizeBytes: stats.size,
    },
    output: {
      filePath: outputPath,
      fileUrl,
      fileSizeBytes: stats.size,
    },
    completedAt: new Date(),
  });

  // Remove only the intermediate concat files, keep all source assets for review
  if (fs.existsSync(concatPath)) fs.unlinkSync(concatPath);
  if (fs.existsSync(concatOutput)) fs.unlinkSync(concatOutput);

  emitProjectComplete({ projectId, downloadUrl: fileUrl });

  return { outputPath, fileUrl, durationSeconds: 0, fileSizeBytes: stats.size };
}

// ─── FFmpeg Helpers ───────────────────────────────────────────────────────────

function runFFmpeg(
  setup: (cmd: ffmpeg.FfmpegCommand) => void,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();
    setup(cmd);

    if (onProgress) {
      cmd.on('progress', p => onProgress(Math.round(p.percent ?? 0)));
    }

    cmd
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(new Error(`FFmpeg error: ${err.message}`)))
      .run();
  });
}

function validateFileHasStream(filePath: string, streamType: 'audio' | 'video'): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(new Error(`ffprobe failed for ${filePath}: ${err.message}`));

      const hasStream = metadata.streams.some(s => s.codec_type === streamType);
      if (!hasStream) {
        return reject(new Error(`File ${filePath} has no ${streamType} stream`));
      }
      resolve();
    });
  });
}
