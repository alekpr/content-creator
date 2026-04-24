import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';

// Set system ffmpeg path for fluent-ffmpeg
ffmpeg.setFfmpegPath(env.FFMPEG_PATH);
import { ProjectModel } from '../models/Project.model.js';
import { emitProjectComplete } from '../socket/socket.handler.js';
import { env } from '../config/env.js';
import type { AssemblyConfig, AssemblyResult, VoiceoverSceneTiming } from '@content-creator/shared';

// ─── Service ──────────────────────────────────────────────────────────────────

export async function assembleVideo(
  projectId: string,
  videoPaths: string[],
  voicePath: string,
  musicPath: string | null,
  config: AssemblyConfig,
  onProgress: (percent: number) => void,
  sceneTimings?: VoiceoverSceneTiming[],
): Promise<AssemblyResult> {
  const tempDir = path.join(env.TEMP_DIR, projectId);
  const outputDir = env.OUTPUT_DIR;
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, `${projectId}.mp4`);
  const concatPath = path.join(tempDir, 'filelist.txt');
  const normalizedClips: string[] = [];

  // Step 1: Normalize clips first so concat is stable even for user-uploaded files.
  const preparedPaths = await Promise.all(
    videoPaths.map(async (videoPath, idx) => {
      const normalizedPath = path.join(tempDir, `scene_norm_${idx + 1}.mp4`);
      normalizedClips.push(normalizedPath);
      await normalizeVideoClip(videoPath, normalizedPath);
      return normalizedPath;
    })
  );

  // Step 2: Extend any video clips whose matching audio is longer than the clip
  // (happens when narration is too long to speed up cleanly — freeze last frame instead)
  const extendedClips: string[] = []; // track for cleanup
  const resolvedPaths = await Promise.all(
    preparedPaths.map(async (videoPath, idx) => {
      const timing = sceneTimings?.[idx];
      if (!timing) return videoPath;

      const overrun = timing.audioDuration - timing.videoDuration;
      if (overrun <= 0.1) return videoPath; // no extension needed

      const extPath = path.join(tempDir, `scene_ext_${timing.sceneId}.mp4`);
      extendedClips.push(extPath);
      await freezeExtendVideo(videoPath, extPath, overrun);
      return extPath;
    })
  );

  // Step 3: Write concat list (use absolute paths for safety)
  const fileList = resolvedPaths.map(p => `file '${path.resolve(p)}'`).join('\n');
  fs.writeFileSync(concatPath, fileList);

  // Step 4: Concat video clips
  const concatOutput = path.join(tempDir, 'video_concat.mp4');
  await runFFmpeg(cmd =>
    cmd
      .input(concatPath)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy'])
      .output(concatOutput)
  );

  // Step 5: Validate audio streams exist
  await validateFileHasStream(voicePath, 'audio');
  if (musicPath) await validateFileHasStream(musicPath, 'audio');

  // Step 6: Mix video + audio
  //  - Music is looped if shorter than voiceover (stream_loop -1 + duration=first)
  //  - Fade in/out applied to MUSIC only (voiceover stays flat)
  //  - Voiceover just gets volume adjustment
  const crf = config.outputQuality === 'high' ? '18' : '23';
  const fadeIn  = config.fadeInSeconds  > 0 ? config.fadeInSeconds  : 0;
  const fadeOut = config.fadeOutSeconds > 0 ? config.fadeOutSeconds : 0;

  // Probe concat duration so fade-out start time can be calculated absolutely
  const concatDuration = fadeOut > 0 ? await probeDuration(concatOutput) : 0;

  // Build music-only filter chain: volume → optional fade in → optional fade out
  const buildMusicFilters = (volValue: number): string[] => {
    const filters: string[] = [`[2:a]volume=${volValue}:precision=fixed[music_vol]`];
    let cur = '[music_vol]';
    if (fadeIn > 0) {
      filters.push(`${cur}afade=t=in:st=0:d=${fadeIn.toFixed(3)}[music_fi]`);
      cur = '[music_fi]';
    }
    if (fadeOut > 0 && concatDuration > fadeOut) {
      const st = (concatDuration - fadeOut).toFixed(3);
      filters.push(`${cur}afade=t=out:st=${st}:d=${fadeOut.toFixed(3)}[music_fo]`);
      cur = '[music_fo]';
    }
    // ensure final label is [music]
    if (cur !== '[music]') {
      filters[filters.length - 1] = filters[filters.length - 1].replace(/\[[^\]]+\]$/, '[music]');
    }
    return filters;
  };

  await runFFmpeg(
    cmd => {
      cmd.input(concatOutput);

      if (musicPath) {
        cmd
          .input(voicePath)
          .input(musicPath).inputOptions(['-stream_loop -1'])  // loop music indefinitely
          .complexFilter([
            // voice: volume only, no fades
            `[1:a]volume=${config.voiceVolume}:precision=fixed[voice]`,
            // music: volume + fade in/out
            ...buildMusicFilters(config.musicVolume),
            // mix: duration follows voice (first input), music is trimmed/looped to match
            `[voice][music]amix=inputs=2:duration=first[aout]`,
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
        // voice only — volume adjustment, no fades
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
  const durationSeconds = await probeDuration(outputPath);
  const fileUrl = `/api/projects/${projectId}/download`;

  // Update MongoDB
  await ProjectModel.findByIdAndUpdate(projectId, {
    status: 'completed',
    'stages.assembly.status': 'approved',
    'stages.assembly.completedAt': new Date(),
    'stages.assembly.result': {
      outputPath,
      fileUrl,
      durationSeconds,
      fileSizeBytes: stats.size,
    },
    output: {
      filePath: outputPath,
      fileUrl,
      fileSizeBytes: stats.size,
      durationSeconds,
    },
    completedAt: new Date(),
  });

  // Remove intermediate concat + extended-clip files, keep all source assets for review
  if (fs.existsSync(concatPath))  fs.unlinkSync(concatPath);
  if (fs.existsSync(concatOutput)) fs.unlinkSync(concatOutput);
  for (const p of normalizedClips) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  for (const p of extendedClips) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  emitProjectComplete({ projectId, downloadUrl: fileUrl });

  return { outputPath, fileUrl, durationSeconds, fileSizeBytes: stats.size };
}

// ─── FFmpeg Helpers ───────────────────────────────────────────────────────────

function normalizeVideoClip(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .videoFilters([
        'fps=30',
        'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        'format=yuv420p',
        'setpts=PTS-STARTPTS',
      ])
      .noAudio()
      .outputOptions(['-c:v libx264', '-preset veryfast', '-crf 23', '-movflags +faststart'])
      .output(output)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(new Error(`normalizeVideoClip error: ${err.message}`)))
      .run();
  });
}

/**
 * Extend a video clip by freezing its last frame for `extraSecs` seconds.
 * Uses tpad filter (pad video at the end by cloning the last frame).
 */
function freezeExtendVideo(input: string, output: string, extraSecs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .videoFilters(`tpad=stop_mode=clone:stop_duration=${extraSecs.toFixed(3)}`)
      .outputOptions(['-c:v libx264', '-crf 23', '-an'])
      .output(output)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(new Error(`freezeExtendVideo error: ${err.message}`)))
      .run();
  });
}

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

function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) { resolve(0); return; }
      resolve(Math.round((metadata.format.duration ?? 0) * 10) / 10);
    });
  });
}
