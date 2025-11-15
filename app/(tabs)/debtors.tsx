import AddDebtorModal from '@/components/AddDebtorModal';
import { useDebtors } from '@/database/useDebtors';
import { Debtor } from '@/types/debtor';
import { Ionicons } from '@expo/vector-icons';
import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function DebtorsScreen() {
  const { debtors, loading, error, reload } = useDebtors();
  const [modalVisible, setModalVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const filteredDebtors = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = debtors ?? [];
    if (q.length > 0) {
      list = list.filter((d) => d.name.toLowerCase().includes(q));
    }
    if (sortOrder === 'asc') {
      return [...list].sort((a, b) => a.balance - b.balance);
    }
    return [...list].sort((a, b) => b.balance - a.balance);
  }, [debtors, query, sortOrder]);

  // Reload debtors whenever screen comes into focus
  useFocusEffect(
    useCallback(() => {
      reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const renderDebtor = ({ item }: { item: Debtor }) => (
    <Link href={`/debtor/${item.id}` as any} asChild>
      <TouchableOpacity
        style={styles.debtorCard}
        activeOpacity={0.8}
      >
        <View style={styles.debtorAvatarWrap}>
          <View style={styles.debtorAvatar}>
            <Text style={styles.debtorAvatarText}>{item.name.charAt(0).toUpperCase()}</Text>
          </View>
        </View>
        <View style={styles.debtorInfo}>
          <Text style={styles.debtorName}>{item.name}</Text>
          <View style={styles.debtorRow}>
            <Text style={styles.debtorBalanceIcon}>Rs.
              
            </Text>
            <Text style={styles.debtorBalance}>{item.balance.toFixed(2)}</Text>
          </View>
        </View>
        <View style={styles.arrowContainer}>
          <Text style={styles.arrowText}>››</Text>
          
        </View>
      </TouchableOpacity>
    </Link>
  );

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.loadingText}>Loading debtors...</Text>
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.loadingText}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Debtors</Text>
        <Text style={styles.subtitle}>Total: {filteredDebtors.length}</Text>
        <View style={styles.searchContainer}>
          <View style={styles.searchRow}>
            <View style={styles.searchInputWrap}>
              <TextInput
                placeholder="Search debtors..."
                placeholderTextColor="#9ba1a6"
                value={query}
                onChangeText={setQuery}
                style={styles.searchInput}
                returnKeyType="search"
              />
              {query.length > 0 && (
                <TouchableOpacity
                  onPress={() => setQuery('')}
                  style={styles.clearButton}
                  accessibilityLabel="Clear search"
                >
                  <Text style={styles.clearButtonText}>×</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={styles.filtersRow}>
            <View style={styles.segmentedContainer}>
              {/* Single toggle: pressing flips between desc (High→Low) and asc (Low→High) */}
              <TouchableOpacity
                style={[styles.segmentIconWrap, sortOrder === 'desc' && styles.segmentActive]}
                onPress={() => setSortOrder((s) => (s === 'desc' ? 'asc' : 'desc'))}
                accessibilityLabel={sortOrder === 'desc' ? 'Currently High to Low. Tap to switch to Low to High' : 'Currently Low to High. Tap to switch to High to Low'}
              >
                <Ionicons name={sortOrder === 'desc' ? 'arrow-down-outline' : 'arrow-up-outline'} size={18} color={sortOrder === 'desc' ? '#fff' : '#9ba1a6'} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      {filteredDebtors.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyText}>{debtors.length === 0 ? 'No debtors found' : 'No debtors match'}</Text>
          {debtors.length === 0 && <Text style={styles.emptySubtext}>Add your first debtor to get started</Text>}
        </View>
      ) : (
        <FlatList
          data={filteredDebtors}
          renderItem={renderDebtor}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.listContainer}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={reload}
            />
          }
        />)}

      {/* Floating Add Button */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.8}
        onPress={() => setModalVisible(true)}
      >
        <View style={styles.fabInner}>
          <Text style={styles.fabIcon}>+</Text>
        </View>
      </TouchableOpacity>

      <AddDebtorModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSuccess={reload}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#25292e',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#25292e',
  },
  header: {
    padding: 20,
    paddingTop: 60,
    backgroundColor: '#1a1d21',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#9ba1a6',
  },
  listContainer: {
    padding: 16,
  },
  debtorCard: {
    backgroundColor: '#1a1d21',
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 2,
  },
  debtorAvatarWrap: {
    marginRight: 16,
  },
  debtorAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#0606fab6',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#3b82f6',
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  debtorAvatarText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
  },
  debtorInfo: {
    flex: 1,
    gap: 2,
  },
  debtorName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 2,
  },
  debtorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
    gap: 4,
  },
  debtorBalanceIcon: {
    fontSize: 16,
    color: '#f59e42',
    marginRight: 2,
  },
  debtorBalance: {
    fontSize: 16,
    color: '#f59e42',
    fontWeight: '600',
  },
  debtorPhoneIcon: {
    fontSize: 15,
    color: '#3b82f6',
    marginRight: 2,
  },
  debtorPhones: {
    fontSize: 14,
    color: '#9ba1a6',
    fontWeight: '500',
  },
  arrowContainer: {
    justifyContent: 'center',
    paddingLeft: 12,
  },
  arrowText: {
    fontSize: 32,
    color: '#00bfffff',
    fontWeight: '300',
  },
  loadingText: {
    fontSize: 18,
    color: '#9ba1a6',
  },
  emptyText: {
    fontSize: 20,
    color: '#fff',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 16,
    color: '#9ba1a6',
  },
  fab: {
    position: 'absolute',
    right: 24,
    bottom: 32,
    zIndex: 10,
    elevation: 5,
  },
  fabInner: {
    backgroundColor: '#0808dbff',
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  fabIcon: {
    color: '#fff',
    fontSize: 36,
    fontWeight: 'bold',
    marginTop: -2,
  },
  searchContainer: {
    marginTop: 12,
    width: '100%',
    paddingHorizontal: 4,
    gap: 8,
  },
  filtersRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
    paddingRight: 8,
  },
  searchInput: {
    backgroundColor: '#1a1d21',
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    fontSize: 16,
  },
  sortContainer: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 8,
  },
  sortButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#101216',
  },
  sortButtonActive: {
    backgroundColor: '#0b61f6',
  },
  sortButtonText: {
    color: '#9ba1a6',
    fontSize: 13,
    fontWeight: '600',
  },
  sortButtonTextActive: {
    color: '#fff',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInputWrap: {
    position: 'relative',
    width: '100%',
  },
  clearButton: {
    position: 'absolute',
    right: 8,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0b61f6',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  clearButtonText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 16,
  },
  segmentedContainer: {
    flexDirection: 'row',
    marginLeft: 8,
    marginTop: 0,
    backgroundColor: 'transparent',
    borderRadius: 12,
    overflow: 'hidden',
    alignSelf: 'flex-end',
  },
  segmentIconWrap: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginLeft: 6,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: '#0b61f6',
  },
  segmentText: {
    color: '#9ba1a6',
    fontWeight: '600',
  },
  segmentTextActive: {
    color: '#fff',
  },
});
