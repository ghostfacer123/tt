import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Switch,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useAuth } from '../services/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../services/supabase';
import { loadGroupReceipt, loadGroupMembers, claimReceiptItem } from '../services/groupService';
import type { GroupReceipt, GroupReceiptItem, GroupMember } from '../services/groupService';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'GroupReceiptSplit'>;

export default function GroupReceiptSplitScreen({ navigation, route }: Props) {
  const { groupId, receiptId } = route.params;
  const { user } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();

  const [receipt, setReceipt] = useState<GroupReceipt | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [splitEqually, setSplitEqually] = useState(false);

  const fetchReceipt = useCallback(async () => {
    try {
      const [data, memberData] = await Promise.all([
        loadGroupReceipt(receiptId),
        loadGroupMembers(groupId),
      ]);
      setReceipt(data);
      setMembers(memberData);
    } catch (error) {
      console.error('Error loading receipt:', error);
    } finally {
      setLoading(false);
    }
  }, [receiptId, groupId]);

  useEffect(() => {
    fetchReceipt();

    // Subscribe to real-time item claims
    const subscription = supabase
      .channel(`item-claims-${receiptId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'item_claims' }, () => {
        fetchReceipt();
      })
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [receiptId, fetchReceipt]);

  const handleQuantityChange = async (item: GroupReceiptItem, change: number) => {
    const newQty = Math.max(1, Math.min(99, item.quantity + change));
    if (newQty === item.quantity) return;

    // Optimistic update
    setReceipt((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((i) => (i.id === item.id ? { ...i, quantity: newQty } : i)),
      };
    });

    try {
      await supabase.from('group_receipt_items').update({ quantity: newQty }).eq('id', item.id);
    } catch (error) {
      console.error('Error updating quantity:', error);
      Alert.alert(t('common.error'), t('common.error'));
      fetchReceipt(); // Revert on error
    }
  };

  const handleToggleClaim = async (item: GroupReceiptItem) => {
    if (!user) return;
    const isClaimed = item.claimed_by.includes(user.id);

    // Optimistic update
    setReceipt((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((i) => {
          if (i.id !== item.id) return i;
          return {
            ...i,
            claimed_by: isClaimed
              ? i.claimed_by.filter((uid) => uid !== user.id)
              : [...i.claimed_by, user.id],
          };
        }),
      };
    });

    try {
      await claimReceiptItem(item.id, user.id, !isClaimed);
    } catch (error) {
      console.error('Error claiming item:', error);
      fetchReceipt(); // Revert on error
    }
  };

  const myTotal = () => {
    if (!receipt || !user) return 0;
    if (splitEqually) {
      const claimers = new Set<string>();
      receipt.items.forEach((item) => item.claimed_by.forEach((uid) => claimers.add(uid)));
      const count = Math.max(claimers.size, 1);
      return receipt.total_amount / count;
    }
    return receipt.items
      .filter((item) => item.claimed_by.includes(user.id))
      .reduce(
        (sum, item) => sum + (item.price * item.quantity) / Math.max(item.claimed_by.length, 1),
        0
      );
  };

  const getMemberTotal = (memberId: string) => {
    if (!receipt) return 0;
    if (splitEqually) {
      const claimers = new Set<string>();
      receipt.items.forEach((item) => item.claimed_by.forEach((uid) => claimers.add(uid)));
      const count = Math.max(claimers.size, 1);
      return receipt.total_amount / count;
    }
    return receipt.items
      .filter((item) => item.claimed_by.includes(memberId))
      .reduce(
        (sum, item) => sum + (item.price * item.quantity) / Math.max(item.claimed_by.length, 1),
        0
      );
  };

  const payerId = receipt?.paid_by;
  const payerMember = members.find((m) => m.user_id === payerId);
  const payerName = payerMember
    ? payerMember.user_id === user?.id
      ? t('split.you')
      : payerMember.name
    : null;

  const payerTotal = payerId ? getMemberTotal(payerId) : 0;
  const overdueTotal = members
    .filter((m) => m.user_id !== payerId)
    .reduce((sum, m) => sum + getMemberTotal(m.user_id), 0);

  const handleMarkAsPaid = async () => {
    if (!user || !receipt) return;
    const amount = myTotal();
    Alert.alert(t('groups.mark_as_paid'), `${t('groups.you_owe')} ${amount.toFixed(2)} EGP?`, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('groups.mark_as_paid'),
        onPress: async () => {
          try {
            await supabase.from('group_settlements').upsert(
              {
                group_id: groupId,
                receipt_id: receiptId,
                payer_id: user.id,
                payee_id: receipt.paid_by,
                amount,
                status: 'paid',
                paid_at: new Date().toISOString(),
              },
              { onConflict: 'receipt_id,payer_id' }
            );
            Alert.alert(t('common.success'), t('groups.payment_marked'));
            navigation.goBack();
          } catch (error) {
            console.error('Error marking as paid:', error);
            Alert.alert(t('common.error'), t('common.error'));
          }
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: GroupReceiptItem }) => {
    const isClaimed = user ? item.claimed_by.includes(user.id) : false;
    const claimCount = item.claimed_by.length;
    const myShare = claimCount > 0 ? item.price / claimCount : item.price;

    return (
      <TouchableOpacity
        style={[
          styles.itemRow,
          { backgroundColor: theme.colors.card },
          isClaimed && { borderLeftWidth: 3, borderLeftColor: theme.colors.primary },
        ]}
        onPress={() => handleToggleClaim(item)}
      >
        <View
          style={[
            styles.checkbox,
            { borderColor: isClaimed ? theme.colors.primary : theme.colors.border },
          ]}
        >
          {isClaimed && <Ionicons name="checkmark" size={16} color={theme.colors.primary} />}
        </View>
        <View style={styles.itemInfo}>
          <Text style={[styles.itemName, { color: theme.colors.text }]}>{item.name}</Text>
          {claimCount > 1 && (
            <Text style={[styles.sharedText, { color: theme.colors.textSecondary }]}>
              {t('groups.shared_item')} ({claimCount} people)
            </Text>
          )}
        </View>
        <View style={styles.quantityRow}>
          <TouchableOpacity
            style={[styles.quantityBtn, { backgroundColor: theme.colors.surface }]}
            onPress={() => handleQuantityChange(item, -1)}
          >
            <Ionicons name="remove" size={16} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={[styles.quantityText, { color: theme.colors.text }]}>x{item.quantity}</Text>
          <TouchableOpacity
            style={[styles.quantityBtn, { backgroundColor: theme.colors.surface }]}
            onPress={() => handleQuantityChange(item, 1)}
          >
            <Ionicons name="add" size={16} color={theme.colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.itemPriceContainer}>
          <Text style={[styles.itemPrice, { color: theme.colors.text }]}>
            {(item.price * item.quantity).toFixed(2)}
          </Text>
          {isClaimed && claimCount > 1 && (
            <Text style={[styles.myShareText, { color: theme.colors.primary }]}>
              Your share: {myShare.toFixed(2)}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} style={styles.loader} />
      </SafeAreaView>
    );
  }

  if (!receipt) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
          </TouchableOpacity>
        </View>
        <Text style={[styles.errorText, { color: theme.colors.textSecondary }]}>
          {t('groups.receipt_not_found')}
        </Text>
      </SafeAreaView>
    );
  }

  const isUserPayer = user?.id === payerId;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
            {receipt.merchant_name}
          </Text>
          <Text style={[styles.headerTotal, { color: theme.colors.primary }]}>
            {receipt.total_amount.toFixed(2)} EGP
          </Text>
        </View>
      </View>

      {/* Receipt Image */}
      {receipt.image_url ? (
        <Image
          source={{ uri: receipt.image_url }}
          style={styles.receiptImage}
          resizeMode="contain"
        />
      ) : null}

      {/* Payment Summary */}
      {payerName && (
        <View style={[styles.paymentSummary, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.paymentSummaryTitle, { color: theme.colors.text }]}>
            {t('groups.payment_summary')}
          </Text>
          <View style={styles.paymentSummaryRow}>
            <Text style={styles.paymentSummaryPaid}>
              ✅ {payerName} {t('groups.paid')}: {receipt.total_amount.toFixed(2)} EGP
            </Text>
          </View>
          {overdueTotal > 0 && (
            <View style={styles.paymentSummaryRow}>
              <Text style={styles.paymentSummaryOverdue}>
                ⏰ {t('groups.overdue')}: {overdueTotal.toFixed(2)} EGP
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Split type toggle */}
      <View style={[styles.splitToggle, { backgroundColor: theme.colors.surface }]}>
        <Text style={[styles.splitToggleLabel, { color: theme.colors.text }]}>
          {splitEqually ? t('groups.split_equally') : t('groups.each_selects')}
        </Text>
        <Switch
          value={splitEqually}
          onValueChange={setSplitEqually}
          trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
          thumbColor="#fff"
        />
      </View>

      {/* Instructions */}
      {!splitEqually && (
        <Text style={[styles.instructions, { color: theme.colors.textSecondary }]}>
          {t('groups.select_items')}
        </Text>
      )}

      {/* Items list */}
      <FlatList
        data={receipt.items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
      />

      {/* My total footer */}
      <View
        style={[
          styles.footer,
          { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border },
        ]}
      >
        {isUserPayer ? (
          <View>
            <Text style={[styles.footerLabel, { color: theme.colors.textSecondary }]}>
              {t('groups.owed_to_you')}
            </Text>
            <Text style={[styles.footerTotal, { color: theme.colors.success }]}>
              +{overdueTotal.toFixed(2)} EGP
            </Text>
          </View>
        ) : (
          <View>
            <Text style={[styles.footerLabel, { color: theme.colors.textSecondary }]}>
              {t('groups.you_owe')}
            </Text>
            <Text style={[styles.footerTotal, { color: theme.colors.primary }]}>
              {myTotal().toFixed(2)} EGP
            </Text>
          </View>
        )}
        {!isUserPayer && (
          <TouchableOpacity
            style={[styles.paidButton, { backgroundColor: theme.colors.primary }]}
            onPress={handleMarkAsPaid}
          >
            <Ionicons
              name="checkmark-circle-outline"
              size={18}
              color="#fff"
              style={{ marginRight: 6 }}
            />
            <Text style={styles.paidButtonText}>{t('groups.mark_as_paid')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loader: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    gap: 12,
  },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  headerTotal: { fontSize: 16, fontWeight: '600', marginTop: 2 },
  errorText: { textAlign: 'center', marginTop: 40, fontSize: 16 },
  receiptImage: {
    width: '100%',
    height: 200,
    backgroundColor: '#000',
  },
  paymentSummary: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    padding: 14,
  },
  paymentSummaryTitle: { fontSize: 14, fontWeight: '700', marginBottom: 8 },
  paymentSummaryRow: { marginVertical: 2 },
  paymentSummaryPaid: { fontSize: 14, fontWeight: '600', color: '#22c55e' },
  paymentSummaryOverdue: { fontSize: 14, fontWeight: '600', color: '#ef4444' },
  splitToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
  },
  splitToggleLabel: { fontSize: 15, fontWeight: '600' },
  instructions: { fontSize: 13, marginHorizontal: 16, marginTop: 8, marginBottom: 4 },
  list: { paddingVertical: 8, paddingHorizontal: 16 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginVertical: 4,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 15, fontWeight: '500' },
  sharedText: { fontSize: 12, marginTop: 2 },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginRight: 12,
  },
  quantityBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quantityText: {
    fontSize: 14,
    fontWeight: '600',
    minWidth: 30,
    textAlign: 'center',
  },
  itemPriceContainer: { alignItems: 'flex-end' },
  itemPrice: { fontSize: 15, fontWeight: '600' },
  myShareText: { fontSize: 12, marginTop: 2 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderTopWidth: 1,
  },
  footerLabel: { fontSize: 13 },
  footerTotal: { fontSize: 22, fontWeight: 'bold', marginTop: 2 },
  paidButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
  },
  paidButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
