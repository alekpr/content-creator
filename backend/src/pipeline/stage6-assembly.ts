import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
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
  ffmpeg.setFfmpegPath(env.FFMPEG_PATH);
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

  // Step 1.5: Compute duration compensation for xfade transitions.
  //
  // When sceneTransitionMode = 'xfade', each transition overlaps the end of clip A with the start of clip B,
  // reducing total video duration by (N-1) * transitionDurationSeconds.
  // To preserve sync with voiceover, we must add extra visual duration to scenes BEFORE fitting.
  //
  // Strategy: distribute the total overlap budget evenly across all scenes.
  const transitionMode = config.sceneTransitionMode ?? 'cut';
  const transitionDur = config.transitionDurationSeconds ?? 0.5;
  const numScenes = sceneTimings?.length ?? videoPaths.length;

  let compensatedTimings = sceneTimings;
  if (transitionMode === 'xfade' && sceneTimings && numScenes > 1) {
    const totalOverlap = (numScenes - 1) * transitionDur;
    const compensationPerScene = totalOverlap / numScenes;
    compensatedTimings = sceneTimings.map(timing => ({
      ...timing,
      videoDuration: timing.videoDuration + compensationPerScene,
      audioDuration: timing.audioDuration + compensationPerScene,
    }));
  }

  // Step 2: Fit each video clip to its matching voiceover duration.
  //
  //   videoFitMode = 'speed' (user selected):
  //     • audio > video  → slow down clip (setpts ratio > 1)
  //     • video > audio  → speed up clip (setpts ratio < 1), capped at maxSpeedRatio
  //     • either exceeds maxSpeedRatio → fallback: freeze (overrun) or trim (underrun)
  //
  //   videoFitMode = 'freeze' (default):
  //     • audio > video  → freeze last frame
  //     • video > audio  → trim
  //     • within ±0.1 s → no-op
  const fitMode      = config.videoFitMode  ?? 'freeze';
  const maxSpeedRatio = config.maxSpeedRatio ?? 1.5;

  const extendedClips: string[] = []; // track for cleanup
  const resolvedPaths = await Promise.all(
    preparedPaths.map(async (videoPath, idx) => {
      const timing = compensatedTimings?.[idx];
      if (!timing) return videoPath;

      const overrun  = timing.audioDuration - timing.videoDuration; // audio > video  (positive)
      const underrun = timing.videoDuration - timing.audioDuration; // video > audio  (positive)

      if (fitMode === 'speed') {
        // ── Speed mode: retime the clip to exactly match audio duration ───────
        if (overrun > 0.1) {
          // Slow down: ratio = audioDuration / videoDuration > 1
          const slowRatio = timing.audioDuration / timing.videoDuration;
          if (slowRatio <= maxSpeedRatio) {
            const strPath = path.join(tempDir, `scene_str_${timing.sceneId}.mp4`);
            extendedClips.push(strPath);
            await stretchVideoClip(videoPath, strPath, timing.audioDuration);
            return strPath;
          } else {
            // Too slow would look unnatural — fallback to freeze
            const extPath = path.join(tempDir, `scene_ext_${timing.sceneId}.mp4`);
            extendedClips.push(extPath);
            await freezeExtendVideo(videoPath, extPath, overrun);
            return extPath;
          }
        }

        if (underrun > 0.1) {
          // Speed up: ratio = videoDuration / audioDuration > 1
          const fastRatio = timing.videoDuration / timing.audioDuration;
          if (fastRatio <= maxSpeedRatio) {
            const strPath = path.join(tempDir, `scene_str_${timing.sceneId}.mp4`);
            extendedClips.push(strPath);
            await stretchVideoClip(videoPath, strPath, timing.audioDuration);
            return strPath;
          } else {
            // Too fast — fallback to trim
            const trimPath = path.join(tempDir, `scene_trim_${timing.sceneId}.mp4`);
            extendedClips.push(trimPath);
            await trimVideoClip(videoPath, trimPath, timing.audioDuration);
            return trimPath;
          }
        }
      } else {
        // ── Freeze mode (default): freeze or trim, never retime ──────────────
        if (overrun > 0.1) {
          const extPath = path.join(tempDir, `scene_ext_${timing.sceneId}.mp4`);
          extendedClips.push(extPath);
          await freezeExtendVideo(videoPath, extPath, overrun);
          return extPath;
        }

        if (underrun > 0.1) {
          const trimPath = path.join(tempDir, `scene_trim_${timing.sceneId}.mp4`);
          extendedClips.push(trimPath);
          await trimVideoClip(videoPath, trimPath, timing.audioDuration);
          return trimPath;
        }
      }

      return videoPath; // within ±0.1 s tolerance
    })
  );

  // Step 3-4: Join video clips — branch on transition mode
  const concatOutput = path.join(tempDir, 'video_concat.mp4');

  if (transitionMode === 'cut') {
    // ── Cut mode: fast concat demuxer (no re-encoding) ────────────────────────
    const fileList = resolvedPaths.map(p => `file '${path.resolve(p)}'`).join('\n');
    fs.writeFileSync(concatPath, fileList);

    await runFFmpeg(cmd =>
      cmd
        .input(concatPath)
        .inputOptions(['-f concat', '-safe 0'])
        .outputOptions(['-c copy'])
        .output(concatOutput)
    );
  } else {
    // ── Xfade mode: filter graph with crossfade transitions ───────────────────
    if (resolvedPaths.length < 2) {
      // Single scene: no transition possible, just copy
      await runFFmpeg(cmd =>
        cmd
          .input(resolvedPaths[0])
          .outputOptions(['-c copy'])
          .output(concatOutput)
      );
    } else {
      // Build xfade filter chain for N scenes
      await buildXfadeConcat(resolvedPaths, concatOutput, transitionDur, compensatedTimings || []);
    }
  }

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
  const loopBackgroundMusic = config.loopBackgroundMusic ?? true;

  // Probe concat duration so fade-out start time can be calculated absolutely
  const concatDuration = fadeOut > 0 ? await probeDuration(concatOutput) : 0;
  const musicDuration = musicPath ? await probeDuration(musicPath) : 0;
  const effectiveMusicDuration = musicPath
    ? (loopBackgroundMusic ? concatDuration : Math.min(concatDuration, musicDuration || concatDuration))
    : 0;

  // Build music-only filter chain: volume → optional fade in → optional fade out
  const buildMusicFilters = (volValue: number): string[] => {
    const filters: string[] = [`[2:a]volume=${volValue}:precision=fixed[music_vol]`];
    let cur = '[music_vol]';
    if (fadeIn > 0) {
      filters.push(`${cur}afade=t=in:st=0:d=${fadeIn.toFixed(3)}[music_fi]`);
      cur = '[music_fi]';
    }
    if (fadeOut > 0 && effectiveMusicDuration > fadeOut) {
      const st = (effectiveMusicDuration - fadeOut).toFixed(3);
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
          .input(musicPath);

        if (loopBackgroundMusic) {
          cmd.inputOptions(['-stream_loop -1']);
        }

        cmd
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
 * Build xfade filter graph to join multiple clips with crossfade transitions.
 * Uses chained xfade filters with computed offsets based on compensated durations.
 */
async function buildXfadeConcat(
  clipPaths: string[],
  output: string,
  transitionDur: number,
  timings: VoiceoverSceneTiming[]
): Promise<void> {
  if (clipPaths.length < 2) {
    throw new Error('buildXfadeConcat requires at least 2 clips');
  }

  // Probe actual durations of fitted clips
  const actualDurations = await Promise.all(clipPaths.map(p => probeDuration(p)));

  // Build xfade filter chain
  // For N clips, we need N-1 xfade filters
  // Each xfade has: [prev][next]xfade=transition=fade:duration=D:offset=O[out]
  // where offset = when transition starts in the 'prev' input
  const filterParts: string[] = [];
  let outputDuration = 0;

  for (let i = 0; i < clipPaths.length - 1; i++) {
    const prevLabel = i === 0 ? '[0:v]' : `[v${i}]`;
    const nextLabel = `[${i + 1}:v]`;
    const outLabel = i === clipPaths.length - 2 ? '[vout]' : `[v${i + 1}]`;
    
    let offset: number;
    if (i === 0) {
      // First xfade: transition starts at (clip0_duration - transitionDur)
      offset = actualDurations[0] - transitionDur;
      outputDuration = actualDurations[0] + actualDurations[1] - transitionDur;
    } else {
      // Subsequent xfade: transition starts at (output_duration - transitionDur)
      offset = outputDuration - transitionDur;
      outputDuration = outputDuration + actualDurations[i + 1] - transitionDur;
    }
    
    filterParts.push(
      `${prevLabel}${nextLabel}xfade=transition=fade:duration=${transitionDur.toFixed(3)}:offset=${offset.toFixed(3)}${outLabel}`
    );
  }

  const complexFilter = filterParts.join(';');

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();
    
    // Add all input clips
    clipPaths.forEach(p => cmd.input(p));
    
    cmd
      .complexFilter([complexFilter])
      .outputOptions([
        '-map [vout]',
        '-c:v libx264',
        '-preset veryfast',
        '-crf 23',
        '-movflags +faststart',
      ])
      .output(output)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(new Error(`buildXfadeConcat error: ${err.message}`)))
      .run();
  });
}

/**
 * Speed up a video clip so its total duration matches `targetDuration`.
 * Uses setpts to retime PTS without re-encoding motion (just frame timing).
 */
function stretchVideoClip(input: string, output: string, targetDuration: number): Promise<void> {
  // Probe the actual source duration so we can compute a literal PTS ratio.
  // DURATION is not reliably available as a setpts variable across all ffmpeg builds.
  return probeDuration(input).then(sourceDuration => {
    if (sourceDuration <= 0) return Promise.reject(new Error(`stretchVideoClip: could not probe duration of ${input}`));
    const ratio = (targetDuration / sourceDuration).toFixed(6);
    return new Promise<void>((resolve, reject) => {
      ffmpeg(input)
        .videoFilters([
          // Scale PTS by ratio: ratio > 1 = slow down, ratio < 1 = speed up
          `setpts=${ratio}*PTS`,
          'fps=30',
          'scale=trunc(iw/2)*2:trunc(ih/2)*2',
          'format=yuv420p',
          'setpts=PTS-STARTPTS',
        ])
        .noAudio()
        .outputOptions(['-c:v libx264', '-preset veryfast', '-crf 23', '-movflags +faststart'])
        .output(output)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(new Error(`stretchVideoClip error: ${err.message}`)))
        .run();
    });
  });
}

/**
 * Hard-trim a video clip to `targetDuration` seconds (used when speed-up would be > 1.5×).
 */
function trimVideoClip(input: string, output: string, targetDuration: number): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .duration(targetDuration)
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
      .on('error', (err: Error) => reject(new Error(`trimVideoClip error: ${err.message}`)))
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
