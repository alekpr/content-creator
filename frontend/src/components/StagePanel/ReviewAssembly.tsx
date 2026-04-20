import type { Project, AssemblyResult } from '@content-creator/shared';

interface ReviewAssemblyProps {
  project: Project;
}

export function ReviewAssembly({ project }: ReviewAssemblyProps) {
  const result = project.stages.assembly.result as AssemblyResult | undefined;
  if (!result) return <p className="text-sm text-gray-400">Assembly not complete yet.</p>;

  const downloadUrl = `/api/projects/${project._id}/download`;

  return (
    <div className="space-y-3">
      <video
        src={downloadUrl}
        controls
        className="w-full rounded-lg aspect-video bg-black"
      />
      <div className="flex items-center gap-3">
        <a
          href={downloadUrl}
          download
          className="rounded-lg bg-green-600 text-white px-4 py-2 text-sm font-medium hover:bg-green-700"
        >
          ↓ Download Video
        </a>
        <span className="text-xs text-gray-500">
          {result.durationSeconds}s · {(result.fileSizeBytes / 1_000_000).toFixed(1)} MB
        </span>
      </div>
    </div>
  );
}
