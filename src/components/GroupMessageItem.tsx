import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../services/supabase';
import type { GroupMessage } from '../services/groupService';

interface GroupMessageItemProps {
  message: GroupMessage;
  isOwnMessage: boolean;
  onReceiptPress?: (receiptId: string) => void;
}

interface ReceiptStats {
  payerName: string;
  paidAmount: number;
  overdueAmount: number;
  imageUrl?: string;
}

export const GroupMessageItem: React.FC<GroupMessageItemProps> = ({
  message,
  isOwnMessage,
  onReceiptPress,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [receiptStats, setReceiptStats] = useState<ReceiptStats | null>(null);

  useEffect(() => {
    if (message.message_type !== 'receipt' || !message.receipt_id) return;

    const fetchReceiptStats = async () => {
      try {
        const { data } = await supabase
          .from('group_receipts')
          .select(
            `
            paid_by,
            receipt_image_url,
            group_receipt_items (
              price,
              quantity,
              item_claims (user_id)
            )
          `
          )
          .eq('id', message.receipt_id!)
          .single();

        if (!data) return;

        const paidBy: string | null = data.paid_by ?? null;
        let paidAmount = 0;
        let overdueAmount = 0;

        for (const item of data.group_receipt_items ?? []) {
          const itemTotal = item.price * (item.quantity ?? 1);
          const claimers: string[] = (item.item_claims ?? []).map(
            (c: { user_id: string }) => c.user_id
          );
          const claimerCount = Math.max(claimers.length, 1);
          const sharePerPerson = itemTotal / claimerCount;

          for (const claimer of claimers) {
            if (claimer === paidBy) {
              paidAmount += sharePerPerson;
            } else {
              overdueAmount += sharePerPerson;
            }
          }
        }

        let payerName = '';
        if (paidBy) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('name')
            .eq('id', paidBy)
            .single();
          payerName = profile?.name ?? '';
        }

        setReceiptStats({
          payerName,
          paidAmount,
          overdueAmount,
          imageUrl: data.receipt_image_url ?? undefined,
        });
      } catch {
        // ignore fetch errors for stats
      }
    };

    fetchReceiptStats();
  }, [message.receipt_id, message.message_type]);

  const time = new Date(message.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (message.message_type === 'receipt' && message.receipt_id) {
    return (
      <View style={[styles.row, isOwnMessage ? styles.rowRight : styles.rowLeft]}>
        <TouchableOpacity
          style={[styles.receiptBubble, { backgroundColor: theme.colors.primary }]}
          onPress={() => onReceiptPress?.(message.receipt_id!)}
        >
          <View style={styles.receiptIcon}>
            <Ionicons name="receipt-outline" size={28} color="#fff" />
          </View>
          {receiptStats?.imageUrl ? (
            <Image
              source={{ uri: receiptStats.imageUrl }}
              style={styles.receiptThumbnail}
              resizeMode="cover"
            />
          ) : null}
          <Text style={styles.receiptTitle}>{message.content}</Text>
          {receiptStats && (
            <View style={styles.receiptStats}>
              {receiptStats.payerName ? (
                <View style={styles.receiptStatRow}>
                  <Ionicons name="checkmark-circle" size={14} color="#4CAF50" />
                  <Text style={styles.receiptStatPaid}>
                    {' '}
                    {receiptStats.payerName} {t('groups.paid')}:{' '}
                    {receiptStats.paidAmount.toFixed(2)} EGP
                  </Text>
                </View>
              ) : null}
              {receiptStats.overdueAmount > 0 && (
                <View style={styles.receiptStatRow}>
                  <Ionicons name="time" size={14} color="#FF5252" />
                  <Text style={styles.receiptStatOverdue}>
                    {' '}
                    {t('groups.overdue')}: {receiptStats.overdueAmount.toFixed(2)} EGP
                  </Text>
                </View>
              )}
            </View>
          )}
          <Text style={styles.receiptTap}>{t('groups.tap_to_split')}</Text>
          <Text style={styles.bubbleTime}>{time}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.row, isOwnMessage ? styles.rowRight : styles.rowLeft]}>
      {!isOwnMessage && (
        <View style={[styles.senderAvatar, { backgroundColor: theme.colors.primary }]}>
          <Text style={styles.senderInitial}>{message.sender_name.charAt(0).toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.bubbleContainer}>
        {!isOwnMessage && (
          <Text style={[styles.senderName, { color: theme.colors.textSecondary }]}>
            {message.sender_name}
          </Text>
        )}
        <View
          style={[
            styles.bubble,
            isOwnMessage
              ? { backgroundColor: theme.colors.primary }
              : { backgroundColor: theme.colors.surface },
          ]}
        >
          <Text style={[styles.messageText, { color: isOwnMessage ? '#fff' : theme.colors.text }]}>
            {message.content}
          </Text>
          <Text
            style={[
              styles.bubbleTime,
              { color: isOwnMessage ? 'rgba(255,255,255,0.7)' : theme.colors.textSecondary },
            ]}
          >
            {time}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginVertical: 4,
    marginHorizontal: 12,
    alignItems: 'flex-end',
  },
  rowLeft: { justifyContent: 'flex-start' },
  rowRight: { justifyContent: 'flex-end' },
  senderAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  senderInitial: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  bubbleContainer: { maxWidth: '75%' },
  senderName: { fontSize: 12, marginBottom: 2, marginLeft: 4 },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  messageText: { fontSize: 15 },
  bubbleTime: { fontSize: 11, marginTop: 4, textAlign: 'right' },
  receiptBubble: {
    padding: 14,
    borderRadius: 16,
    maxWidth: '75%',
    alignItems: 'center',
  },
  receiptIcon: { marginBottom: 8 },
  receiptThumbnail: {
    width: 200,
    height: 120,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  receiptTitle: { color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  receiptStats: { marginTop: 8, marginBottom: 4, alignSelf: 'stretch' },
  receiptStatRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 2 },
  receiptStatPaid: { color: '#4CAF50', fontSize: 13, fontWeight: '600' },
  receiptStatOverdue: { color: '#FF5252', fontSize: 13, fontWeight: '600' },
  receiptTap: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 4 },
});
