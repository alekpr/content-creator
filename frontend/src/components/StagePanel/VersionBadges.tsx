interface VersionBadgesProps {
  versions: string[];
  selectedFilename: string;
  loading: boolean;
  onSelect: (filename: string) => void;
}

export function VersionBadges({ versions, selectedFilename, loading, onSelect }: VersionBadgesProps) {
  if (versions.length <= 1) return null;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className="text-[10px] text-gray-400 shrink-0">Versions:</span>
      {versions.map((filename, i) => (
        <button
          key={filename}
          onClick={() => onSelect(filename)}
          disabled={loading || filename === selectedFilename}
          title={filename}
          className={`text-[10px] rounded px-1.5 py-0.5 font-medium transition-colors disabled:opacity-60 ${
            filename === selectedFilename
              ? 'bg-indigo-600 text-white cursor-default'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          v{i + 1}
        </button>
      ))}
    </div>
  );
}
