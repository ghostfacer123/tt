import { supabase } from './supabase';

export interface Group {
  id: string;
  name: string;
  avatar_url?: string;
  created_by: string;
  created_at: string;
  member_count: number;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  name: string;
  email?: string;
  joined_at: string;
}

export interface GroupMessage {
  id: string;
  group_id: string;
  sender_id: string;
  sender_name: string;
  content: string;
  message_type: 'text' | 'receipt';
  receipt_id?: string;
  created_at: string;
}

export interface GroupReceipt {
  id: string;
  group_id: string;
  uploaded_by: string;
  paid_by?: string;
  image_url?: string;
  merchant_name: string;
  total_amount: number;
  status: 'pending' | 'settled' | 'cancelled' | 'archived'; // ✅ FIXED - removed 'splitting'
  created_at: string;
  items: GroupReceiptItem[];
}

export interface GroupReceiptItem {
  id: string;
  receipt_id: string;
  name: string;
  price: number;
  quantity: number;
  claimed_by: string[];
}

export interface GroupSettlement {
  id: string;
  group_id: string;
  receipt_id: string;
  payer_id: string;
  payee_id: string;
  amount: number;
  status: 'pending' | 'paid';
  created_at: string;
}

// ============================================
// Load Groups (with separate queries to avoid recursion)
// ============================================
export const loadGroups = async (userId: string): Promise<Group[]> => {
  console.log('📊 [loadGroups] Starting for user:', userId);

  try {
    // Step 1: Get group IDs where user is a member
    const { data: memberData, error: memberError } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', userId);

    if (memberError) {
      console.error('❌ Error loading memberships:', memberError);
      throw memberError;
    }

    const groupIds = memberData?.map((m) => m.group_id) || [];

    if (groupIds.length === 0) {
      console.log('ℹ️ No groups found');
      return [];
    }

    // Step 2: Get group details (separate query - no join!)
    const { data: groupsData, error: groupsError } = await supabase
      .from('groups')
      .select('id, name, avatar_url, created_by, created_at')
      .in('id', groupIds)
      .order('created_at', { ascending: false });

    if (groupsError) {
      console.error('❌ Error loading groups:', groupsError);
      throw groupsError;
    }

    // Step 3: Get member counts for each group
    const groupsWithCounts = await Promise.all(
      (groupsData || []).map(async (group) => {
        const { count } = await supabase
          .from('group_members')
          .select('*', { count: 'exact', head: true })
          .eq('group_id', group.id);

        return {
          id: group.id,
          name: group.name,
          avatar_url: group.avatar_url,
          created_by: group.created_by,
          created_at: group.created_at,
          member_count: count || 0,
        };
      })
    );

    console.log(`✅ Loaded ${groupsWithCounts.length} groups`);
    return groupsWithCounts;
  } catch (error) {
    console.error('❌ Error in loadGroups:', error);
    throw error;
  }
};

// ============================================
// Load Group Members
// ============================================
export const loadGroupMembers = async (groupId: string): Promise<GroupMember[]> => {
  const { data, error } = await supabase
    .from('group_members')
    .select(
      `
      id,
      group_id,
      user_id,
      joined_at,
      profiles (name, email)
    `
    )
    .eq('group_id', groupId);

  if (error) throw error;

  return (data ?? []).map((d: any) => ({
    id: d.id,
    group_id: d.group_id,
    user_id: d.user_id,
    name: d.profiles?.name ?? 'Unknown',
    email: d.profiles?.email,
    joined_at: d.joined_at,
  }));
};

// ============================================
// Load Group Messages
// ============================================
export const loadGroupMessages = async (groupId: string): Promise<GroupMessage[]> => {
  const { data, error } = await supabase
    .from('group_messages')
    .select(
      `
      id,
      group_id,
      sender_id,
      message_text,
      message_type,
      receipt_id,
      sent_at,
      profiles (name)
    `
    )
    .eq('group_id', groupId)
    .is('deleted_at', null)
    .order('sent_at', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((d: any) => ({
    id: d.id,
    group_id: d.group_id,
    sender_id: d.sender_id,
    sender_name: d.profiles?.name ?? 'Unknown',
    content: d.message_text ?? '',
    message_type: d.message_type ?? 'text',
    receipt_id: d.receipt_id,
    created_at: d.sent_at,
  }));
};

// ============================================
// Send Group Message
// ============================================
export const sendGroupMessage = async (
  groupId: string,
  senderId: string,
  content: string,
  messageType: 'text' | 'receipt' = 'text',
  receiptId?: string
): Promise<void> => {
  const { error } = await supabase.from('group_messages').insert({
    group_id: groupId,
    sender_id: senderId,
    message_text: content,
    message_type: messageType,
    receipt_id: receiptId ?? null,
  });
  if (error) throw error;
};

// ============================================
// Create Group
// ============================================
export const createGroup = async (
  name: string,
  createdBy: string,
  memberIds: string[] = []
): Promise<Group> => {
  console.log('🏗️ Creating group:', name);

  const { data: group, error: groupError } = await supabase
    .from('groups')
    .insert({ name, created_by: createdBy })
    .select()
    .single();

  if (groupError) {
    console.error('❌ Error creating group:', groupError);
    throw groupError;
  }

  console.log('✅ Group created:', group.id);

  // Add extra members (creator is auto-added by trigger)
  if (memberIds.length > 0) {
    const memberInserts = memberIds.map((uid) => ({
      group_id: group.id,
      user_id: uid,
      role: 'member',
    }));

    const { error: membersError } = await supabase.from('group_members').insert(memberInserts);

    if (membersError) {
      console.error('❌ Error adding members:', membersError);
    } else {
      console.log(`✅ Added ${memberIds.length} members`);
    }
  }

  return {
    ...group,
    member_count: memberIds.length + 1,
  };
};

// ============================================
// Load Group Receipt
// ============================================
export const loadGroupReceipt = async (receiptId: string): Promise<GroupReceipt | null> => {
  const { data, error } = await supabase
    .from('group_receipts')
    .select(
      `
      id,
      group_id,
      uploaded_by,
      paid_by,
      receipt_image_url,
      merchant_name,
      total_amount,
      status,
      created_at,
      group_receipt_items (
        id,
        receipt_id,
        name,
        price,
        quantity,
        item_claims (user_id)
      )
    `
    )
    .eq('id', receiptId)
    .single();

  if (error) {
    console.error('❌ Error loading receipt:', error);
    return null;
  }

  return {
    id: data.id,
    group_id: data.group_id,
    uploaded_by: data.uploaded_by,
    paid_by: data.paid_by ?? undefined,
    image_url: data.receipt_image_url,
    merchant_name: data.merchant_name || 'Unknown',
    total_amount: data.total_amount,
    status: data.status,
    created_at: data.created_at,
    items: (data.group_receipt_items ?? []).map((item: any) => ({
      id: item.id,
      receipt_id: item.receipt_id,
      name: item.name,
      price: item.price,
      quantity: item.quantity ?? 1,
      claimed_by: (item.item_claims ?? []).map((c: any) => c.user_id),
    })),
  };
};

// ============================================
// Claim Receipt Item
// ============================================
export const claimReceiptItem = async (
  itemId: string,
  userId: string,
  claim: boolean
): Promise<void> => {
  if (claim) {
    const { error } = await supabase.from('item_claims').insert({
      receipt_item_id: itemId,
      user_id: userId,
    });
    if (error) console.error('❌ Error claiming item:', error);
  } else {
    const { error } = await supabase
      .from('item_claims')
      .delete()
      .eq('receipt_item_id', itemId)
      .eq('user_id', userId);
    if (error) console.error('❌ Error unclaiming item:', error);
  }
};

// ============================================
// Create Group Receipt from OCR
// ============================================
export const createGroupReceiptFromOCR = async (
  groupId: string,
  uploadedBy: string,
  paidBy: string,
  merchantName: string,
  totalAmount: number,
  items: Array<{ name: string; price: number; quantity?: number }>,
  imageUrl?: string
): Promise<GroupReceipt> => {
  console.log('📝 Creating group receipt...');
  console.log('🔍 Parameters:', { groupId, uploadedBy, paidBy, merchantName, totalAmount });

  const { data: receipt, error: receiptError } = await supabase
    .from('group_receipts')
    .insert({
      group_id: groupId,
      uploaded_by: uploadedBy,
      paid_by: paidBy,
      merchant_name: merchantName,
      total_amount: totalAmount,
      subtotal: totalAmount,
      status: 'pending', // ✅ FIXED - changed from 'splitting' to 'pending'
      receipt_image_url: imageUrl ?? null,
    })
    .select()
    .single();

  if (receiptError) {
    console.error('❌ Error creating receipt:', receiptError);
    throw receiptError;
  }

  console.log('✅ Receipt created:', receipt.id);

  if (items.length > 0) {
    const itemInserts = items.map((item) => ({
      receipt_id: receipt.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity ?? 1,
    }));

    const { data: insertedItems, error: itemsError } = await supabase
      .from('group_receipt_items')
      .insert(itemInserts)
      .select();

    if (itemsError) {
      console.error('❌ Error creating items:', itemsError);
    } else {
      console.log(`✅ Created ${insertedItems?.length} items`);
    }

    return {
      ...receipt,
      image_url: receipt.receipt_image_url,
      items: (insertedItems ?? []).map((item: any) => ({
        id: item.id,
        receipt_id: item.receipt_id,
        name: item.name,
        price: item.price,
        quantity: item.quantity ?? 1,
        claimed_by: [],
      })),
    };
  }

  return {
    ...receipt,
    image_url: receipt.receipt_image_url,
    items: [],
  };
};

// Add member to group
export const addGroupMember = async (groupId: string, userId: string): Promise<void> => {
  const { error } = await supabase.from('group_members').insert({ group_id: groupId, user_id: userId });
  if (error) throw error;
};

// Remove member from group
export const removeGroupMember = async (groupId: string, userId: string): Promise<void> => {
  const { error } = await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', userId);
  if (error) throw error;
};

// Delete group (only creator)
export const deleteGroup = async (groupId: string): Promise<void> => {
  const { error } = await supabase.from('groups').delete().eq('id', groupId);
  if (error) throw error;
};

// Delete receipt
export const deleteGroupReceipt = async (receiptId: string): Promise<void> => {
  // Mark all settlements as cancelled
  await supabase.from('group_settlements').update({ status: 'paid' }).eq('receipt_id', receiptId);
  const { error } = await supabase.from('group_receipts').delete().eq('id', receiptId);
  if (error) throw error;
};

// Archive receipt manually
export const archiveGroupReceipt = async (receiptId: string): Promise<void> => {
  const { error } = await supabase
    .from('group_receipts')
    .update({ status: 'archived', settled_at: new Date().toISOString() })
    .eq('id', receiptId);
  if (error) throw error;
};

// Check if all settlements are paid and auto-archive
export const checkAndAutoArchive = async (receiptId: string): Promise<boolean> => {
  const { data: settlements } = await supabase
    .from('group_settlements')
    .select('status')
    .eq('receipt_id', receiptId);

  if (!settlements || settlements.length === 0) return false;
  const allPaid = settlements.every((s: any) => s.status === 'paid');

  if (allPaid) {
    await supabase
      .from('group_receipts')
      .update({ status: 'archived', settled_at: new Date().toISOString() })
      .eq('id', receiptId);
  }
  return allPaid;
};

// Load archived receipts for a group
export const loadArchivedReceipts = async (groupId: string): Promise<GroupReceipt[]> => {
  const { data, error } = await supabase
    .from('group_receipts')
    .select(`
      id, group_id, uploaded_by, paid_by, receipt_image_url,
      merchant_name, total_amount, status, created_at,
      group_receipt_items (id, receipt_id, name, price, quantity, item_claims (user_id))
    `)
    .eq('group_id', groupId)
    .eq('status', 'archived')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((d: any) => ({
    id: d.id,
    group_id: d.group_id,
    uploaded_by: d.uploaded_by,
    paid_by: d.paid_by ?? undefined,
    image_url: d.receipt_image_url,
    merchant_name: d.merchant_name || 'Unknown',
    total_amount: d.total_amount,
    status: d.status,
    created_at: d.created_at,
    items: (d.group_receipt_items ?? []).map((item: any) => ({
      id: item.id,
      receipt_id: item.receipt_id,
      name: item.name,
      price: item.price,
      quantity: item.quantity ?? 1,
      claimed_by: (item.item_claims ?? []).map((c: any) => c.user_id),
    })),
  }));
};

// Load group settlements (for balance breakdown)
export interface BalanceItem {
  settlementId: string;
  receiptId: string;
  groupId: string;
  groupName: string;
  merchantName: string;
  receiptDate: string;
  itemNames: string[];
  totalAmount: number;
  toUserId: string;
  toUserName: string;
  status: 'pending' | 'paid';
}

export const loadMyPendingSettlements = async (userId: string): Promise<BalanceItem[]> => {
  // Get all pending settlements where this user owes money
  const { data: settlements, error } = await supabase
    .from('group_settlements')
    .select('id, receipt_id, group_id, from_user, to_user, total_amount, amount, status')
    .or(`from_user.eq.${userId},payer_id.eq.${userId}`)
    .neq('status', 'paid');

  if (error) {
    console.error('Error loading settlements:', error);
    return [];
  }

  const result: BalanceItem[] = [];
  for (const settlement of settlements ?? []) {
    // Get receipt info
    const { data: receipt } = await supabase
      .from('group_receipts')
      .select('merchant_name, created_at, group_id, group_receipt_items(name, item_claims(user_id))')
      .eq('id', settlement.receipt_id)
      .single();

    if (!receipt) continue;

    // Get group name
    const { data: group } = await supabase
      .from('groups')
      .select('name')
      .eq('id', settlement.group_id ?? receipt.group_id)
      .single();

    // Get payer name
    const payeeId = settlement.to_user ?? (settlement as any).payee_id;
    const { data: payeeProfile } = payeeId
      ? await supabase.from('profiles').select('name').eq('id', payeeId).single()
      : { data: null };

    // Get user's claimed item names
    const itemNames = (receipt.group_receipt_items ?? [])
      .filter((item: any) => (item.item_claims ?? []).some((c: any) => c.user_id === userId))
      .map((item: any) => item.name);

    result.push({
      settlementId: settlement.id,
      receiptId: settlement.receipt_id,
      groupId: settlement.group_id ?? receipt.group_id,
      groupName: group?.name ?? 'Group',
      merchantName: receipt.merchant_name ?? 'Unknown',
      receiptDate: receipt.created_at,
      itemNames,
      totalAmount: settlement.total_amount ?? settlement.amount ?? 0,
      toUserId: payeeId ?? '',
      toUserName: payeeProfile?.name ?? 'Unknown',
      status: settlement.status,
    });
  }

  return result;
};

// ============================================
// Mark Settlement as Paid
// ============================================
export const markSettlementAsPaid = async (settlementId: string): Promise<void> => {
  const { error } = await supabase
    .from('group_settlements')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
    })
    .eq('id', settlementId);

  if (error) {
    console.error('❌ Error marking settlement as paid:', error);
    throw error;
  }

  console.log('✅ Settlement marked as paid');
};
