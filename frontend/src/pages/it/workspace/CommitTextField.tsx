import { TextField } from '@mui/material';
import { useFieldDraft } from '../../../hooks/useFieldDraft';
import { drawerFieldValueSx } from '../../../theme/formSx';

/**
 * A one-line site property saved when focus leaves it (Enter too): typing is never interrupted by
 * a save, and a save under way does not touch the field the person went on to.
 */
export default function CommitTextField({ value, label, placeholder, size, disabled, onCommit }: {
  value: string;
  label?: string;
  placeholder: string;
  size?: 'small' | 'medium';
  disabled?: boolean;
  onCommit: (next: string) => void;
}) {
  const { draft, setDraft, onFocus, onBlur } = useFieldDraft(value);
  return (
    <TextField
      label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={onFocus}
      onBlur={() => {
        onBlur();
        onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      size={size}
      variant="standard"
      sx={drawerFieldValueSx}
      placeholder={placeholder}
      disabled={disabled}
    />
  );
}
