import { Platform, Share } from 'react-native';

/**
 * Saves text as a file: a download in the browser (with a byte-order mark, so Excel reads ₹ and
 * names in any script correctly); on phones, the share sheet with the text.
 */
export async function saveTextFile(name: string, text: string, mime = 'text/csv'): Promise<void> {
  if (Platform.OS !== 'web') {
    await Share.share({ message: text, title: name });
    return;
  }
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Opens the browser's file picker and resolves with the chosen files (none if cancelled). Web only. */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    input.onchange = () => {
      resolve(Array.from(input.files ?? []));
      input.remove();
    };
    // Cancel fires no change event in every browser; `cancel` covers the ones that support it.
    input.addEventListener('cancel', () => {
      resolve([]);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}
