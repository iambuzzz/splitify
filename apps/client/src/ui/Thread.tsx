import { useState } from 'react';
import { View } from 'react-native';
import { ME, type ThreadMessage } from '../data/model';
import { useTheme } from '../theme/ThemeProvider';
import { Avatar, Button, Chip, Field, T, styles } from './kit';

const time = (iso: string) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

/**
 * A short money conversation: an expense's thread or a pair's settle-up thread. My messages sit on
 * the right; questions carry their resolved state. `seen` is one line under the last message.
 */
export function Thread({
  messages,
  nameOf,
  onSend,
  allowQuestions = false,
  canResolve,
  onResolve,
  seen,
  placeholder,
  empty,
  readOnly,
}: {
  messages: ThreadMessage[];
  nameOf: (memberId: string) => string;
  onSend: (text: string, question: boolean) => void;
  allowQuestions?: boolean;
  canResolve?: (m: ThreadMessage) => boolean;
  onResolve?: (m: ThreadMessage) => void;
  seen?: string | null;
  placeholder: string;
  empty: string;
  /** Shown instead of the box to write in (say, the group is closed). */
  readOnly?: string;
}) {
  const { theme } = useTheme();
  const [text, setText] = useState('');
  const [question, setQuestion] = useState(false);
  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t, question);
    setText('');
    setQuestion(false);
  };

  return (
    <View style={{ gap: 10 }}>
      {messages.length === 0 ? (
        <T size={14} color={theme.c.muted}>
          {empty}
        </T>
      ) : null}
      {messages.map((m, i) => {
        const mine = m.by === ME;
        const showName = !mine && messages[i - 1]?.by !== m.by;
        return (
          <View key={m.id} style={{ alignItems: mine ? 'flex-end' : 'flex-start', gap: 4 }}>
            <View style={[styles.row, { alignItems: 'flex-end', gap: 8, maxWidth: '88%', flexDirection: mine ? 'row-reverse' : 'row' }]}>
              {!mine ? <Avatar name={nameOf(m.by)} size={26} /> : null}
              <View
                style={{
                  backgroundColor: mine ? theme.c.tint : theme.c.surfaceAlt,
                  borderRadius: 16,
                  borderBottomRightRadius: mine ? 4 : 16,
                  borderBottomLeftRadius: mine ? 16 : 4,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  gap: 2,
                  flexShrink: 1,
                }}
              >
                {showName || m.kind === 'question' ? (
                  <T size={12} weight="bold" color={m.kind === 'question' ? theme.c.attnText : theme.c.muted}>
                    {[showName ? nameOf(m.by) : null, m.kind === 'question' ? (m.resolved ? 'Question · resolved' : 'Question') : null].filter(Boolean).join(' · ')}
                  </T>
                ) : null}
                <T size={15}>{m.text}</T>
                <T size={11} color={theme.c.muted} style={{ alignSelf: 'flex-end' }}>
                  {time(m.at)}
                </T>
              </View>
            </View>
            {m.kind === 'question' && !m.resolved && !readOnly && canResolve?.(m) ? (
              <View style={{ marginLeft: mine ? 0 : 34 }}>
                <Button title="Mark resolved" size="sm" variant="secondary" icon="check" onPress={() => onResolve?.(m)} />
              </View>
            ) : null}
          </View>
        );
      })}
      {seen ? (
        <T size={12} color={theme.c.muted} style={{ alignSelf: 'flex-end' }}>
          {seen}
        </T>
      ) : null}
      {readOnly ? (
        <T size={13} color={theme.c.muted}>
          {readOnly}
        </T>
      ) : (
        <View style={{ gap: 8 }}>
          <View style={[styles.row, { gap: 8 }]}>
            <Field
              accessibilityLabel={placeholder}
              placeholder={placeholder}
              value={text}
              onChangeText={setText}
              onSubmitEditing={send}
              returnKeyType="send"
              style={{ flex: 1, minWidth: 0, height: 46, fontSize: 15 }}
            />
            <Button title="Send" size="sm" icon="send" disabled={!text.trim()} onPress={send} />
          </View>
          {allowQuestions ? (
            <View style={[styles.row, { gap: 8 }]}>
              <Chip label="Ask as a question" on={question} onPress={() => setQuestion(!question)} />
              <T size={12} color={theme.c.muted} style={{ flex: 1 }}>
                {question ? 'It stays open until the asker or the owner marks it resolved.' : ''}
              </T>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

/** "Seen by Riya, Dev" for the people (other than me) who have seen the latest change. */
export function seenLine(names: string[]): string | null {
  if (names.length === 0) return null;
  return `Seen by ${names.length <= 3 ? names.join(', ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`}`;
}
