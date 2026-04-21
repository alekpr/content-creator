interface GenerateButtonProps {
  loading: boolean;
  onClick: () => void;
  label?: string;
}

export function GenerateButton({ loading, onClick, label = 'Generate' }: GenerateButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-center gap-2 rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
    >
      {loading ? (
        <>
          <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
          Generating…
        </>
      ) : (
        `⚡ ${label}`
      )}
    </button>
  );
}
