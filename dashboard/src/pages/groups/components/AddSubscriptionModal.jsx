import GlassModal from '../../../components/GlassModal';

const AddSubscriptionModal = ({
  isOpen,
  onClose,
  subForm,
  setSubForm,
  subTypes,
  onAddSubscription
}) => {
  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onClose}
      title="添加订阅"
      footer={
        <>
          <button onClick={onClose} className="px-4 py-2 text-gray-300 hover:text-white transition-colors">
            取消
          </button>
          <button onClick={onAddSubscription} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
            添加
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">类型</label>
          <select
            value={subForm.type}
            onChange={(e) => setSubForm({ ...subForm, type: e.target.value })}
            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
          >
            {subTypes.map((type) => (
              <option key={type.value} value={type.value} className="bg-gray-800 text-white">
                {type.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">值 / ID (UID)</label>
          <input
            type="text"
            value={subForm.value}
            onChange={(e) => setSubForm({ ...subForm, value: e.target.value })}
            placeholder={subForm.type === 'user' ? '请输入用户UID' : '请输入SSID'}
            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>
    </GlassModal>
  );
};

export default AddSubscriptionModal;
