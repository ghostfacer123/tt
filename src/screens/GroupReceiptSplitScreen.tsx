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
  TextInput,
  Modal,
  Image,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useAuth } from '../services/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../services/supabase';
import {
  loadGroupReceipt,
  loadGroupMembers,
  claimReceiptItem,
  checkAndAutoArchive,
  archiveGroupReceipt,
  deleteGroupReceipt,
} from '../services/groupService';
import type { GroupReceipt, GroupReceiptItem, GroupMember } from '../services/groupService';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'GroupReceiptSplit'>;

interface MemberSettlement {
  memberId: string;
  memberName: string;
  amount: number;
  status: 'pending' | 'paid';
  settlementId?: string;
}

export default function GroupReceiptSplitScreen({ navigation, route }: Props) {
  const { groupId, receiptId } = route.params;
  const { user } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();

  const [receipt, setReceipt] = useState<GroupReceipt | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [fullscreenImage, setFullscreenImage] = useState(false);

  // Tax/service toggles
  const [hasService, setHasService] = useState(false);
  const [servicePercent, setServicePercent] = useState('12');
  const [hasTax, setHasTax] = useState(false);
  const [taxPercent, setTaxPercent] = useState('14');
  const [hasDelivery, setHasDelivery] = useState(false);
  const [deliveryFee, setDeliveryFee] = useState('0');

  // Payer dashboard
  const [settlements, setSettlements] = useState<MemberSettlement[]>([]);

  const fetchReceipt = useCallback(async () => {
    try {
      const [data, memberData] = await Promise.all([
        loadGroupReceipt(receiptId),
        loadGroupMembers(groupId),
      ]);
      setReceipt(data);
      setMembers(memberData);

      if (data) {
        setHasService(!!data.has_service);
        setHasTax(!!data.has_tax);
        setHasDelivery(!!data.has_delivery);
        if (data.service_percentage) setServicePercent(String(data.service_percentage));
        if (data.tax_percentage) setTaxPercent(String(data.tax_percentage));
        if (data.delivery_fee) setDeliveryFee(String(data.delivery_fee));
      }
    } catch (error) {
      console.error('Error loading receipt:', error);
    } finally {
      setLoading(false);
    }
  }, [receiptId, groupId]);

  const fetchSettlements = useCallback(async () => {
    if (!receipt?.paid_by) return;
    const { data } = await supabase
      .from('group_settlements')
      .select('id, payer_id, from_user, amount, total_amount, status')
      .eq('receipt_id', receiptId);

    const memberMap = new Map(members.map((m) => [m.user_id, m.name]));
    const settlementList: MemberSettlement[] = [];

    for (const s of data ?? []) {
      const memberId = s.from_user ?? s.payer_id;
      if (memberId && memberId !== receipt.paid_by) {
        settlementList.push({
          memberId,
          memberName: memberMap.get(memberId) ?? 'Unknown',
          amount: s.total_amount ?? s.amount ?? 0,
          status: s.status,
          settlementId: s.id,
        });
      }
    }
    setSettlements(settlementList);
  }, [receiptId, receipt?.paid_by, members]);

  useEffect(() => {
    fetchReceipt();
  }, [fetchReceipt]);

  useEffect(() => {
    if (receipt && members.length > 0) {
      fetchSettlements();
    }
  }, [fetchSettlements, receipt, members]);

  useEffect(() => {
    const subscription = supabase
      .channel(`item-claims-${receiptId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'item_claims' }, () => {
        fetchReceipt();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_settlements' }, () => {
        fetchSettlements();
      })
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [receiptId, fetchReceipt, fetchSettlements]);

  const handleToggleClaim = async (item: GroupReceiptItem) => {
    if (!user || !receipt) return;
    const isClaimed = item.claimed_by.includes(user.id);

    // Calculate new items state for optimistic update and settlement computation
    const newItems = receipt.items.map((i) => {
      if (i.id !== item.id) return i;
      return {
        ...i,
        claimed_by: isClaimed
          ? i.claimed_by.filter((uid) => uid !== user.id)
          : [...i.claimed_by, user.id],
      };
    });

    setReceipt((prev) => (prev ? { ...prev, items: newItems } : prev));

    try {
      await claimReceiptItem(item.id, user.id, !isClaimed);
      // Update pending settlement so payer dashboard reflects claimed items in real-time
      if (user.id !== receipt.paid_by) {
        await upsertPendingSettlement(newItems);
      }
    } catch (error) {
      console.error('Error claiming item:', error);
      fetchReceipt();
    }
  };

  // Upsert a pending settlement record based on currently claimed items.
  // Called whenever items are claimed/unclaimed to keep payer dashboard up-to-date.
  const upsertPendingSettlement = async (currentItems: GroupReceiptItem[]) => {
    if (!user || !receipt?.paid_by) return;

    const mySubtotal = currentItems
      .filter((i) => i.claimed_by.includes(user.id))
      .reduce((sum, i) => sum + (i.price * i.quantity) / Math.max(i.claimed_by.length, 1), 0);

    if (mySubtotal === 0) {
      // Remove pending settlement if user unclaimed all items
      await supabase
        .from('group_settlements')
        .delete()
        .eq('receipt_id', receiptId)
        .eq('from_user', user.id)
        .neq('status', 'paid');
      return;
    }

    const recSub = currentItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const prop = recSub > 0 ? mySubtotal / recSub : 0;
    const svcPct = parseFloat(servicePercent) || 0;
    const txPct = parseFloat(taxPercent) || 0;
    const delAmt = parseFloat(deliveryFee) || 0;
    const svcShare = hasService ? recSub * (svcPct / 100) * prop : 0;
    const txShare = hasTax ? recSub * (txPct / 100) * prop : 0;
    const delShare = hasDelivery && members.length > 0 ? delAmt / members.length : 0;
    const total = mySubtotal + svcShare + txShare + delShare;

    const { data: existing } = await supabase
      .from('group_settlements')
      .select('id, status')
      .eq('receipt_id', receiptId)
      .eq('from_user', user.id)
      .maybeSingle();

    if (existing && existing.status !== 'paid') {
      await supabase
        .from('group_settlements')
        .update({
          items_total: mySubtotal,
          tax_share: txShare,
          service_share: svcShare,
          delivery_share: delShare,
          total_amount: total,
          amount: total,
        })
        .eq('id', existing.id);
    } else if (!existing) {
      await supabase.from('group_settlements').insert({
        receipt_id: receiptId,
        from_user: user.id,
        payer_id: user.id,
        to_user: receipt.paid_by,
        payee_id: receipt.paid_by,
        items_total: mySubtotal,
        tax_share: txShare,
        service_share: svcShare,
        delivery_share: delShare,
        total_amount: total,
        amount: total,
        status: 'pending',
      });
    }
  };

  const userSubtotal = (() => {
    if (!receipt || !user) return 0;
    return receipt.items
      .filter((item) => item.claimed_by.includes(user.id))
      .reduce((sum, item) => sum + (item.price * item.quantity) / Math.max(item.claimed_by.length, 1), 0);
  })();

  const receiptSubtotal = receipt?.items.reduce((sum, i) => sum + i.price * i.quantity, 0) ?? 0;

  const proportion = receiptSubtotal > 0 ? userSubtotal / receiptSubtotal : 0;
  const servicePct = parseFloat(servicePercent) || 0;
  const taxPct = parseFloat(taxPercent) || 0;
  const deliveryAmt = parseFloat(deliveryFee) || 0;

  const userServiceShare = hasService ? (receiptSubtotal * (servicePct / 100)) * proportion : 0;
  const userTaxShare = hasTax ? (receiptSubtotal * (taxPct / 100)) * proportion : 0;
  const userDeliveryShare = hasDelivery && members.length > 0 ? deliveryAmt / members.length : 0;
  const userTotal = userSubtotal + userServiceShare + userTaxShare + userDeliveryShare;

  const payerId = receipt?.paid_by;
  const isUserPayer = user?.id === payerId;

  const handleMarkAsPaid = async () => {
    if (!user || !receipt) return;

    if (userSubtotal === 0) {
      Alert.alert(t('common.error'), t('groups.select_items'));
      return;
    }

    Alert.alert(
      t('groups.mark_as_paid'),
      `${t('groups.you_owe')} ${userTotal.toFixed(2)} EGP?`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('groups.mark_as_paid'),
          onPress: async () => {
            try {
              // Check for existing settlement (created when items were claimed)
              const { data: existing } = await supabase
                .from('group_settlements')
                .select('id')
                .eq('receipt_id', receiptId)
                .eq('from_user', user.id)
                .maybeSingle();

              if (existing) {
                // Update existing settlement to paid
                await supabase
                  .from('group_settlements')
                  .update({
                    items_total: userSubtotal,
                    tax_share: userTaxShare,
                    service_share: userServiceShare,
                    delivery_share: userDeliveryShare,
                    total_amount: userTotal,
                    amount: userTotal,
                    status: 'paid',
                    paid_at: new Date().toISOString(),
                  })
                  .eq('id', existing.id);
              } else {
                // Create new settlement as paid (no group_id - column doesn't exist)
                await supabase.from('group_settlements').insert({
                  receipt_id: receiptId,
                  from_user: user.id,
                  payer_id: user.id,
                  to_user: receipt.paid_by,
                  payee_id: receipt.paid_by,
                  items_total: userSubtotal,
                  tax_share: userTaxShare,
                  service_share: userServiceShare,
                  delivery_share: userDeliveryShare,
                  total_amount: userTotal,
                  amount: userTotal,
                  status: 'paid',
                  paid_at: new Date().toISOString(),
                });
              }

              await checkAndAutoArchive(receiptId);

              Alert.alert(t('common.success'), t('groups.payment_marked'));
              navigation.goBack();
            } catch (error) {
              console.error('Error marking as paid:', error);
              Alert.alert(t('common.error'), t('common.error'));
            }
          },
        },
      ]
    );
  };

  const handleArchiveReceipt = () => {
    Alert.alert(t('groups.archive_receipt'), t('groups.archive_receipt') + '?', [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.ok'),
        onPress: async () => {
          try {
            await archiveGroupReceipt(receiptId);
            Alert.alert(t('common.success'), t('groups.receipt_archived'));
            navigation.goBack();
          } catch (error) {
            Alert.alert(t('common.error'), t('common.error'));
          }
        },
      },
    ]);
  };

  const handleDeleteReceipt = () => {
    Alert.alert(t('groups.delete_receipt'), t('groups.delete_receipt_confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteGroupReceipt(receiptId);
            navigation.goBack();
          } catch (error) {
            Alert.alert(t('common.error'), t('common.error'));
          }
        },
      },
    ]);
  };

  const canDelete =
    user?.id === receipt?.uploaded_by || user?.id === receipt?.paid_by;
  const canArchive = user?.id === receipt?.paid_by;

  const renderItem = ({ item }: { item: GroupReceiptItem }) => {
    const isClaimed = user ? item.claimed_by.includes(user.id) : false;
    const claimCount = item.claimed_by.length;

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
            isClaimed && { backgroundColor: theme.colors.primary },
          ]}
        >
          {isClaimed && <Ionicons name="checkmark" size={14} color="#fff" />}
        </View>
        <View style={styles.itemInfo}>
          <Text style={[styles.itemName, { color: theme.colors.text }]}>{item.name}</Text>
          {claimCount > 1 && (
            <Text style={[styles.sharedText, { color: theme.colors.textSecondary }]}>
              {t('groups.shared_item')} ({claimCount})
            </Text>
          )}
        </View>
        <View style={styles.itemPriceContainer}>
          <Text style={[styles.itemPrice, { color: theme.colors.text }]}>
            {(item.price * item.quantity).toFixed(2)}
          </Text>
          {isClaimed && claimCount > 1 && (
            <Text style={[styles.myShareText, { color: theme.colors.primary }]}>
              {(item.price / claimCount).toFixed(2)} EGP
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
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={[styles.errorText, { color: theme.colors.textSecondary }]}>
          {t('groups.receipt_not_found')}
        </Text>
      </SafeAreaView>
    );
  }

  const payerMember = members.find((m) => m.user_id === payerId);
  const payerName = payerMember
    ? payerMember.user_id === user?.id
      ? t('split.you')
      : payerMember.name
    : null;

  const totalCollected = settlements.filter((s) => s.status === 'paid').reduce((sum, s) => sum + s.amount, 0);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={[styles.headerTitle, { color: theme.colors.text }]} numberOfLines={1}>
            {receipt.merchant_name}
          </Text>
          <Text style={[styles.headerSubtitle, { color: theme.colors.primary }]}>
            {receipt.total_amount.toFixed(2)} EGP
          </Text>
        </View>
        <View style={styles.headerActions}>
          {canArchive && receipt.status !== 'archived' && (
            <TouchableOpacity onPress={handleArchiveReceipt} style={styles.headerBtn}>
              <Ionicons name="archive-outline" size={20} color={theme.colors.text} />
            </TouchableOpacity>
          )}
          {canDelete && (
            <TouchableOpacity onPress={handleDeleteReceipt} style={styles.headerBtn}>
              <Ionicons name="trash-outline" size={20} color="#ef4444" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView>
        {/* Receipt Image - Always Visible */}
        {receipt.image_url ? (
          <TouchableOpacity onPress={() => setFullscreenImage(true)} activeOpacity={0.9}>
            <Image
              source={{ uri: receipt.image_url }}
              style={styles.receiptImage}
              resizeMode="cover"
            />
            <View style={styles.imageTapHint}>
              <Ionicons name="expand-outline" size={16} color="#fff" />
              <Text style={styles.imageTapHintText}>{ t('groups.tap_to_fullscreen') }</Text>
            </View>
          </TouchableOpacity>
        ) : null}

        {/* Merchant Info */}
        <View style={[styles.infoCard, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.infoMerchant, { color: theme.colors.text }]}>{receipt.merchant_name}</Text>
          <Text style={[styles.infoDate, { color: theme.colors.textSecondary }]}>
            {new Date(receipt.created_at).toLocaleDateString()}
          </Text>
          {payerName && (
            <Text style={[styles.infoPayer, { color: theme.colors.textSecondary }]}>
              💳 {t('split.paid_by')}: {payerName}
            </Text>
          )}
          {receipt.status === 'archived' && (
            <View style={styles.archivedBadge}>
              <Text style={styles.archivedBadgeText}>✓ {t('groups.archived')}</Text>
            </View>
          )}
        </View>

        {/* Items */}
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
          {t('split.items')}
        </Text>
        {receipt.items.map((item) => (
          <View key={item.id}>
            {renderItem({ item })}
          </View>
        ))}

        {/* Tax/Service Toggles */}
        <View style={[styles.toggleSection, { backgroundColor: theme.colors.surface }]}>
          {/* Service Charge */}
          <View style={styles.toggleRow}>
            <Ionicons name="restaurant-outline" size={18} color={theme.colors.text} />
            <Text style={[styles.toggleLabel, { color: theme.colors.text }]}>
              {t('split.service_charge')}
            </Text>
            <View style={styles.toggleRight}>
              {hasService && (
                <TextInput
                  style={[styles.percentInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
                  value={servicePercent}
                  onChangeText={setServicePercent}
                  keyboardType="numeric"
                  maxLength={4}
                />
              )}
              {hasService && <Text style={{ color: theme.colors.textSecondary }}>%</Text>}
              <Switch
                value={hasService}
                onValueChange={setHasService}
                trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                thumbColor="#fff"
              />
            </View>
          </View>

          {/* Tax */}
          <View style={[styles.toggleRow, styles.toggleRowBorder, { borderTopColor: theme.colors.border }]}>
            <Ionicons name="document-text-outline" size={18} color={theme.colors.text} />
            <Text style={[styles.toggleLabel, { color: theme.colors.text }]}>
              {t('split.tax')}
            </Text>
            <View style={styles.toggleRight}>
              {hasTax && (
                <TextInput
                  style={[styles.percentInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
                  value={taxPercent}
                  onChangeText={setTaxPercent}
                  keyboardType="numeric"
                  maxLength={4}
                />
              )}
              {hasTax && <Text style={{ color: theme.colors.textSecondary }}>%</Text>}
              <Switch
                value={hasTax}
                onValueChange={setHasTax}
                trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                thumbColor="#fff"
              />
            </View>
          </View>

          {/* Delivery */}
          <View style={[styles.toggleRow, styles.toggleRowBorder, { borderTopColor: theme.colors.border }]}>
            <Ionicons name="bicycle-outline" size={18} color={theme.colors.text} />
            <Text style={[styles.toggleLabel, { color: theme.colors.text }]}>
              {t('split.delivery_fee')}
            </Text>
            <View style={styles.toggleRight}>
              {hasDelivery && (
                <TextInput
                  style={[styles.percentInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
                  value={deliveryFee}
                  onChangeText={setDeliveryFee}
                  keyboardType="numeric"
                  maxLength={6}
                />
              )}
              {hasDelivery && <Text style={{ color: theme.colors.textSecondary }}>EGP</Text>}
              <Switch
                value={hasDelivery}
                onValueChange={setHasDelivery}
                trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                thumbColor="#fff"
              />
            </View>
          </View>
        </View>

        {/* Calculation Summary (for non-payers) */}
        {!isUserPayer && userSubtotal > 0 && (
          <View style={[styles.summaryCard, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.summaryTitle, { color: theme.colors.text }]}>{ t('groups.your_summary') }</Text>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: theme.colors.textSecondary }]}>{ t('groups.subtotal') }</Text>
              <Text style={[styles.summaryValue, { color: theme.colors.text }]}>{userSubtotal.toFixed(2)} EGP</Text>
            </View>
            {hasService && (
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: theme.colors.textSecondary }]}>{t('split.service_charge')} ({servicePct}%)</Text>
                <Text style={[styles.summaryValue, { color: theme.colors.text }]}>{userServiceShare.toFixed(2)} EGP</Text>
              </View>
            )}
            {hasTax && (
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: theme.colors.textSecondary }]}>{t('split.tax')} ({taxPct}%)</Text>
                <Text style={[styles.summaryValue, { color: theme.colors.text }]}>{userTaxShare.toFixed(2)} EGP</Text>
              </View>
            )}
            {hasDelivery && (
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: theme.colors.textSecondary }]}>{ t('groups.delivery_share') }</Text>
                <Text style={[styles.summaryValue, { color: theme.colors.text }]}>{userDeliveryShare.toFixed(2)} EGP</Text>
              </View>
            )}
            <View style={[styles.summaryRow, styles.summaryTotalRow]}>
              <Text style={[styles.summaryTotalLabel, { color: theme.colors.text }]}>{ t('groups.your_total') }</Text>
              <Text style={[styles.summaryTotalValue, { color: theme.colors.primary }]}>{userTotal.toFixed(2)} EGP</Text>
            </View>
          </View>
        )}

        {/* Payer Dashboard */}
        {isUserPayer && settlements.length > 0 && (
          <View style={[styles.payerDashboard, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.sectionTitle2, { color: theme.colors.text }]}>{t('groups.payment_status')}</Text>
            {settlements.map((s) => (
              <View key={s.memberId} style={[styles.settlementRow, { borderBottomColor: theme.colors.border }]}>
                <View style={[styles.statusDot, { backgroundColor: s.status === 'paid' ? '#22c55e' : '#f59e0b' }]} />
                <Text style={[styles.settlementName, { color: theme.colors.text }]}>{s.memberName}</Text>
                <Text style={[styles.settlementAmount, { color: theme.colors.text }]}>{s.amount.toFixed(2)} EGP</Text>
                <Text style={[styles.settlementStatus, { color: s.status === 'paid' ? '#22c55e' : '#f59e0b' }]}>
                  {s.status === 'paid' ? '✅' : '⏳'}
                </Text>
              </View>
            ))}
            <View style={styles.collectedRow}>
              <Text style={[styles.collectedLabel, { color: theme.colors.textSecondary }]}>
                {t('groups.total_collected')}
              </Text>
              <Text style={[styles.collectedAmount, { color: theme.colors.success }]}>
                {totalCollected.toFixed(2)} / {receipt.total_amount.toFixed(2)} EGP
              </Text>
            </View>
          </View>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border }]}>
        {isUserPayer ? (
          <View>
            <Text style={[styles.footerLabel, { color: theme.colors.textSecondary }]}>
              {t('groups.owed_to_you')}
            </Text>
            <Text style={[styles.footerTotal, { color: theme.colors.success }]}>
              +{(receipt.total_amount - totalCollected).toFixed(2)} EGP
            </Text>
          </View>
        ) : (
          <View>
            <Text style={[styles.footerLabel, { color: theme.colors.textSecondary }]}>
              {t('groups.you_owe')}
            </Text>
            <Text style={[styles.footerTotal, { color: theme.colors.primary }]}>
              {userTotal.toFixed(2)} EGP
            </Text>
          </View>
        )}
        {!isUserPayer && receipt.status !== 'archived' && (
          <TouchableOpacity
            style={[styles.paidButton, { backgroundColor: theme.colors.primary }]}
            onPress={handleMarkAsPaid}
          >
            <Ionicons name="checkmark-circle-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.paidButtonText}>{t('groups.mark_as_paid')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Fullscreen Image Modal */}
      <Modal visible={fullscreenImage} transparent animationType="fade">
        <View style={styles.fullscreenModal}>
          <TouchableOpacity style={styles.closeFullscreen} onPress={() => setFullscreenImage(false)}>
            <Ionicons name="close-circle" size={36} color="#fff" />
          </TouchableOpacity>
          {receipt.image_url && (
            <Image
              source={{ uri: receipt.image_url }}
              style={styles.fullscreenImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loader: { flex: 1 },
  backBtn: { padding: 4 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    gap: 12,
  },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  headerSubtitle: { fontSize: 14, fontWeight: '600', marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerBtn: { padding: 6 },
  errorText: { textAlign: 'center', marginTop: 40, fontSize: 16 },
  receiptImage: { width: '100%', height: 220, backgroundColor: '#000' },
  imageTapHint: {
    position: 'absolute',
    bottom: 8,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 4,
  },
  imageTapHintText: { color: '#fff', fontSize: 12 },
  infoCard: { padding: 16, marginBottom: 8 },
  infoMerchant: { fontSize: 20, fontWeight: '700' },
  infoDate: { fontSize: 14, marginTop: 4 },
  infoPayer: { fontSize: 14, marginTop: 4 },
  archivedBadge: { backgroundColor: '#22c55e', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', marginTop: 8 },
  archivedBadgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  sectionTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  sectionTitle2: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    marginVertical: 3,
    marginHorizontal: 16,
    borderRadius: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 15, fontWeight: '500' },
  sharedText: { fontSize: 12, marginTop: 2 },
  itemPriceContainer: { alignItems: 'flex-end' },
  itemPrice: { fontSize: 15, fontWeight: '600' },
  myShareText: { fontSize: 12, marginTop: 2 },
  toggleSection: { margin: 16, borderRadius: 12, padding: 4 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  toggleRowBorder: { borderTopWidth: 1 },
  toggleLabel: { flex: 1, fontSize: 15, fontWeight: '500' },
  toggleRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  percentInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    width: 60,
    textAlign: 'center',
    fontSize: 15,
  },
  summaryCard: { margin: 16, borderRadius: 12, padding: 16, gap: 8 },
  summaryTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel: { fontSize: 14 },
  summaryValue: { fontSize: 14, fontWeight: '500' },
  summaryTotalRow: { borderTopWidth: 1, paddingTop: 8, marginTop: 4, borderTopColor: '#e5e7eb' },
  summaryTotalLabel: { fontSize: 16, fontWeight: '700' },
  summaryTotalValue: { fontSize: 18, fontWeight: '800' },
  payerDashboard: { margin: 16, borderRadius: 12, padding: 16 },
  settlementRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, gap: 10 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  settlementName: { flex: 1, fontSize: 15 },
  settlementAmount: { fontSize: 15, fontWeight: '600' },
  settlementStatus: { fontSize: 18 },
  collectedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  collectedLabel: { fontSize: 13 },
  collectedAmount: { fontSize: 15, fontWeight: '700' },
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
  fullscreenModal: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  closeFullscreen: { position: 'absolute', top: 50, right: 20, zIndex: 10 },
  fullscreenImage: { width: '100%', height: '100%' },
});
