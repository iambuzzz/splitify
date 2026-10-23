import { createElement, useState } from 'react';
import type { Group } from '../data/model';
import { useStore } from '../data/StoreProvider';
import { InviteSheet } from './InviteSheet';

/**
 * Opens the invite sheet for a group: a fresh link (signed in: valid 14 days) to copy, send on
 * WhatsApp or share. Render `sheet` once on the screen that calls `invite`.
 */
export function useInvite(group: Group | undefined) {
  const { account } = useStore();
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const invite = async () => {
    if (!group) return;
    setLink(null);
    setNotice(null);
    setOpen(true);
    try {
      setLink(account ? await account.inviteLink(group.id) : 'https://splitify.app/join');
    } catch (err) {
      setOpen(false);
      setNotice(err instanceof Error ? err.message : 'Could not make an invite link. Try again');
    }
  };
  const sheet = group ? createElement(InviteSheet, { open, link, groupName: group.name, onClose: () => setOpen(false) }) : null;
  return { invite, notice, setNotice, sheet };
}
