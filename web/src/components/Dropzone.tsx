import type { ChangeEvent, DragEvent } from 'react'

interface DropzoneProps {
  /** `accept` attribute for the hidden input, e.g. `application/pdf`. */
  accept: string
  multiple?: boolean
  title: string
  hint: string
  icon?: 'upload' | 'file'
  /** `box`: compact button style (panel). `field`: tall field with a filled state (registration). */
  variant?: 'box' | 'field'
  /** Filled state (field variant): shows a green check, the name and "Toca para reemplazar". */
  fileName?: string | null
  onFiles: (files: File[]) => void
  id?: string
}

const ICONS = {
  upload: (size: number) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#B4235A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 16V4" />
      <path d="m6 10 6-6 6 6" />
      <path d="M4 20h16" />
    </svg>
  ),
  file: (size: number) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#B4235A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  ),
}

/** Click or drag-and-drop file picker. Keyboard: the hidden input is focusable (Enter/Space opens the picker). */
export default function Dropzone({ accept, multiple, title, hint, icon = 'upload', variant = 'field', fileName, onFiles, id }: DropzoneProps) {
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length) onFiles(files)
    e.target.value = ''
  }
  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    if (files.length) onFiles(files)
  }
  const filled = variant === 'field' && !!fileName

  const base =
    variant === 'box'
      ? { border: '2px dashed #B4235A', borderRadius: '14px', background: '#FBF5F7', padding: '26px 16px', gap: '6px' }
      : {
          border: `2px dashed ${filled ? '#1A7F52' : '#B4235A'}`,
          borderRadius: '14px',
          background: '#FBF9FA',
          minHeight: '150px',
          padding: '18px',
          gap: '6px',
        }

  return (
    <label
      className="drop"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      style={{ ...base, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', cursor: 'pointer', color: '#1B1530', position: 'relative' }}
    >
      <input
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={onChange}
        style={{ position: 'absolute', width: '1px', height: '1px', opacity: 0 }}
      />
      {filled ? (
        <>
          <svg width="28" height="28" viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="20" cy="20" r="18" fill="#1A7F52" />
            <path d="m12.5 20.5 5 5 10-11" stroke="#FFFFFF" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={{ fontSize: '14px', fontWeight: 700, wordBreak: 'break-all' }}>{fileName}</span>
          <span style={{ fontSize: '13px', color: '#5A5468' }}>Toca para reemplazar</span>
        </>
      ) : (
        <>
          {ICONS[icon](variant === 'box' ? 28 : 26)}
          <span style={{ fontSize: variant === 'box' ? '16px' : '14px', fontWeight: 700 }}>{title}</span>
          <span style={{ fontSize: '13px', color: '#5A5468' }}>{hint}</span>
        </>
      )}
    </label>
  )
}
