import { noteClip, plainText, soundFiles, type AnkiNote } from '../anki/connect'

export interface AnkiTrack { key: string; noteId: number; filename: string; text: string; field: string }

/** Every attachment is selectable, including multiple sound tags and notes without a transcript. */
export function ankiTracks(notes: AnkiNote[], audioField = '', textField = ''): AnkiTrack[] {
  return notes.flatMap((note) => {
    const parsed = noteClip(note, audioField, textField)
    const text = textField ? plainText(note.fields[textField]?.value ?? '') : parsed?.text ?? ''
    const fields = Object.entries(note.fields).sort((a, b) => a[1].order - b[1].order)
    const seen = new Set<string>()
    return fields.flatMap(([field, value]) => {
      if (audioField && field !== audioField) return []
      return soundFiles(value.value).flatMap((filename) => {
        if (seen.has(filename)) return []
        seen.add(filename)
        return [{ key: `${note.noteId}:${filename}`, noteId: note.noteId, filename, text, field }]
      })
    })
  })
}
