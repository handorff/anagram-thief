import type { Dispatch, SetStateAction } from "react";

type Props = {
  nameDraft: string;
  setNameDraft: Dispatch<SetStateAction<string>>;
  onConfirmName: () => void;
};

export function NameGateView({ nameDraft, setNameDraft, onConfirmName }: Props) {
  return (
    <div className="name-gate">
      <div className="name-card">
        <h1>Choose your name</h1>
        <p className="muted">This is how other players will see you.</p>
        <input
          className="name-input"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && nameDraft.trim()) {
              e.preventDefault();
              onConfirmName();
            }
          }}
          placeholder="Type your name"
          autoFocus
        />
        <button onClick={onConfirmName} disabled={!nameDraft.trim()}>
          Enter Lobby
        </button>
      </div>
    </div>
  );
}
