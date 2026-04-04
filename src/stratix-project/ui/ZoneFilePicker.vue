<template>
  <StratixModal
    :visible="visible"
    title="Add File to Zone"
    width="560px"
    :maskClosable="false"
    @update:visible="handleClose"
    @close="handleClose"
  >
    <div class="zone-file-picker">
      <div class="zone-file-picker__tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="zone-file-picker__tab"
          :class="{ 'zone-file-picker__tab--active': activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          <span class="zone-file-picker__tab-icon">{{ tab.icon }}</span>
          {{ tab.label }}
        </button>
      </div>

      <div class="zone-file-picker__content">
        <div v-if="activeTab === 'local'" class="zone-file-picker__panel">
          <StratixFormField label="File Path" required>
            <div class="zone-file-picker__input-row">
              <StratixInput
                v-model="localFile.path"
                placeholder="/Users/yourname/project/docs/design.md"
                @blur="validateLocalFile"
              />
              <StratixButton variant="secondary" @click="handleBrowseFile">
                Browse
              </StratixButton>
            </div>
            <div v-if="errors.localPath" class="zone-file-picker__error">
              {{ errors.localPath }}
            </div>
          </StratixFormField>

          <StratixFormField label="Display Name">
            <StratixInput
              v-model="localFile.name"
              placeholder="Leave empty to use file name"
            />
          </StratixFormField>
        </div>

        <div v-if="activeTab === 'url'" class="zone-file-picker__panel">
          <StratixFormField label="URL" required>
            <StratixInput
              v-model="urlFile.source"
              type="text"
              placeholder="https://github.com/user/repo/README.md"
              @blur="validateUrl"
            />
            <template #help>
              <span class="zone-file-picker__help">
                Supports GitHub, Figma, and other web resources
              </span>
            </template>
            <div v-if="errors.urlSource" class="zone-file-picker__error">
              {{ errors.urlSource }}
            </div>
          </StratixFormField>

          <StratixFormField label="Display Name">
            <StratixInput
              v-model="urlFile.name"
              placeholder="Leave empty to extract from URL"
            />
          </StratixFormField>
        </div>

        <div v-if="activeTab === 'folder'" class="zone-file-picker__panel">
          <StratixFormField label="Folder Path" required>
            <div class="zone-file-picker__input-row">
              <StratixInput
                v-model="folderScan.path"
                placeholder="/Users/yourname/project/src"
                @blur="validateFolderPath"
              />
              <StratixButton variant="secondary" @click="handleBrowseFolder">
                Browse
              </StratixButton>
            </div>
            <div v-if="errors.folderPath" class="zone-file-picker__error">
              {{ errors.folderPath }}
            </div>
          </StratixFormField>

          <StratixFormField label="File Extensions">
            <StratixInput
              v-model="folderScan.extensions"
              placeholder=".ts, .tsx, .md (leave empty for all)"
            />
            <template #help>
              <span class="zone-file-picker__help">
                Comma-separated list of extensions to include
              </span>
            </template>
          </StratixFormField>

          <StratixFormField>
            <template #label>
              <StratixCheckbox v-model="folderScan.recursive">
                Scan subfolders recursively
              </StratixCheckbox>
            </template>
          </StratixFormField>
        </div>
      </div>

      <div v-if="selectedFiles.length > 0" class="zone-file-picker__selected">
        <div class="zone-file-picker__selected-header">
          <span>Selected Files ({{ selectedFiles.length }})</span>
          <button class="zone-file-picker__clear" @click="clearSelected">
            Clear all
          </button>
        </div>
        <div class="zone-file-picker__selected-list">
          <div
            v-for="(file, index) in selectedFiles"
            :key="index"
            class="zone-file-picker__selected-item"
          >
            <span class="zone-file-picker__selected-icon">{{ file.icon }}</span>
            <span class="zone-file-picker__selected-name">{{ file.name }}</span>
            <span class="zone-file-picker__selected-source">{{ file.source }}</span>
            <button
              class="zone-file-picker__selected-remove"
              @click="removeSelected(index)"
            >
              ×
            </button>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="zone-file-picker__footer">
        <StratixButton @click="handleClose">Cancel</StratixButton>
        <StratixButton
          v-if="activeTab === 'folder'"
          variant="secondary"
          @click="handleScanFolder"
          :disabled="!isFolderValid || scanning"
        >
          {{ scanning ? 'Scanning...' : 'Scan Folder' }}
        </StratixButton>
        <StratixButton
          type="primary"
          @click="handleAddFiles"
          :disabled="selectedFiles.length === 0 || adding"
        >
          {{ adding ? 'Adding...' : `Add ${selectedFiles.length} File${selectedFiles.length !== 1 ? 's' : ''}` }}
        </StratixButton>
      </div>
    </template>
  </StratixModal>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue';
import StratixModal from '@/components/ui/StratixModal.vue';
import StratixButton from '@/components/ui/StratixButton.vue';
import StratixInput from '@/components/ui/StratixInput.vue';
import StratixFormField from '@/components/ui/StratixFormField.vue';
import StratixCheckbox from '@/components/ui/StratixCheckbox.vue';

interface SelectedFile {
  name: string;
  source: string;
  sourceType: 'local' | 'url';
  icon: string;
}

interface Props {
  visible: boolean;
  zoneId?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'close': [];
  'add-files': [files: Array<{ name: string; sourceType: 'local' | 'url'; source: string }>];
  'scan-folder': [data: { folderPath: string; recursive?: boolean; extensions?: string[] }];
}>();

const tabs = [
  { id: 'local', label: 'Local File', icon: '📄' },
  { id: 'url', label: 'URL', icon: '🔗' },
  { id: 'folder', label: 'Folder', icon: '📁' },
] as const;

type TabId = typeof tabs[number]['id'];

const activeTab = ref<TabId>('local');

const localFile = reactive({
  path: '',
  name: '',
});

const urlFile = reactive({
  source: '',
  name: '',
});

const folderScan = reactive({
  path: '',
  extensions: '',
  recursive: true,
});

const errors = reactive({
  localPath: '',
  urlSource: '',
  folderPath: '',
});

const selectedFiles = ref<SelectedFile[]>([]);
const scanning = ref(false);
const adding = ref(false);

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      activeTab.value = 'local';
      localFile.path = '';
      localFile.name = '';
      urlFile.source = '';
      urlFile.name = '';
      folderScan.path = '';
      folderScan.extensions = '';
      folderScan.recursive = true;
      errors.localPath = '';
      errors.urlSource = '';
      errors.folderPath = '';
    }
  }
);

const isFolderValid = computed(() => {
  return folderScan.path.trim().length > 0 && errors.folderPath === '';
});

const validateLocalFile = (): boolean => {
  if (!localFile.path.trim()) {
    errors.localPath = 'File path is required';
    return false;
  }
  errors.localPath = '';
  return true;
};

const validateUrl = (): boolean => {
  if (!urlFile.source.trim()) {
    errors.urlSource = 'URL is required';
    return false;
  }
  try {
    new URL(urlFile.source);
  } catch {
    errors.urlSource = 'Please enter a valid URL';
    return false;
  }
  errors.urlSource = '';
  return true;
};

const validateFolderPath = (): boolean => {
  if (!folderScan.path.trim()) {
    errors.folderPath = 'Folder path is required';
    return false;
  }
  errors.folderPath = '';
  return true;
};

const handleBrowseFile = () => {
  console.log('Browse file - to be implemented with Electron API');
};

const handleBrowseFolder = () => {
  console.log('Browse folder - to be implemented with Electron API');
};

const getFileNameFromPath = (filePath: string): string => {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
};

const getFileIcon = (name: string): string => {
  const ext = name.split('.').pop()?.toLowerCase();
  const iconMap: Record<string, string> = {
    md: '📝',
    txt: '📄',
    ts: '💻',
    tsx: '💻',
    js: '💻',
    jsx: '💎',
    json: '📋',
    png: '🖼️',
    jpg: '🖼️',
    jpeg: '🖼️',
    fig: '🎨',
  };
  return iconMap[ext || ''] || '📎';
};

const extractNameFromUrl = (url: string): string => {
  try {
    const urlObj = new URL(url);
    const parts = urlObj.pathname.split('/');
    return decodeURIComponent(parts[parts.length - 1]) || urlObj.hostname;
  } catch {
    return url;
  }
};

const handleAddLocalFile = () => {
  if (!validateLocalFile()) return;

  const name = localFile.name.trim() || getFileNameFromPath(localFile.path);
  const file: SelectedFile = {
    name,
    source: localFile.path.trim(),
    sourceType: 'local',
    icon: getFileIcon(name),
  };

  selectedFiles.value.push(file);
  localFile.path = '';
  localFile.name = '';
};

const handleAddUrlFile = () => {
  if (!validateUrl()) return;

  const name = urlFile.name.trim() || extractNameFromUrl(urlFile.source);
  const file: SelectedFile = {
    name,
    source: urlFile.source.trim(),
    sourceType: 'url',
    icon: getFileIcon(name),
  };

  selectedFiles.value.push(file);
  urlFile.source = '';
  urlFile.name = '';
};

const handleScanFolder = async () => {
  if (!isFolderValid.value) return;

  scanning.value = true;

  const extensions = folderScan.extensions
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.startsWith('.') || e === '');

  // Properly await the async scan operation before resetting loading state
  try {
    await Promise.resolve(emit('scan-folder', {
      folderPath: folderScan.path.trim(),
      recursive: folderScan.recursive,
      extensions: extensions.length > 0 ? extensions : undefined,
    }));
  } finally {
    scanning.value = false;
  }
};

const addScannedFiles = (files: Array<{ name: string; source: string }>) => {
  for (const file of files) {
    selectedFiles.value.push({
      ...file,
      sourceType: 'local',
      icon: getFileIcon(file.name),
    });
  }
};

defineExpose({ addScannedFiles });

const removeSelected = (index: number) => {
  selectedFiles.value.splice(index, 1);
};

const clearSelected = () => {
  selectedFiles.value = [];
};

const handleClose = () => {
  emit('close');
};

const handleAddFiles = () => {
  if (selectedFiles.value.length === 0) return;

  adding.value = true;

  const files = selectedFiles.value.map((f) => ({
    name: f.name,
    sourceType: f.sourceType,
    source: f.source,
  }));

  emit('add-files', files);
  adding.value = false;
  handleClose();
};
</script>

<style scoped>
.zone-file-picker {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.zone-file-picker__tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--ds-bg-tertiary);
  border-radius: 8px;
}

.zone-file-picker__tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ds-text-secondary);
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.zone-file-picker__tab:hover {
  color: var(--ds-text-primary);
  background: var(--ds-bg-secondary);
}

.zone-file-picker__tab--active {
  color: var(--ds-text-primary);
  background: var(--ds-bg-secondary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.zone-file-picker__tab-icon {
  font-size: 14px;
}

.zone-file-picker__content {
  min-height: 160px;
}

.zone-file-picker__panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.zone-file-picker__input-row {
  display: flex;
  gap: 8px;
}

.zone-file-picker__input-row > *:first-child {
  flex: 1;
}

.zone-file-picker__error {
  color: var(--ds-semantic-danger);
  font-size: 12px;
  margin-top: 4px;
}

.zone-file-picker__help {
  font-size: 11px;
  color: var(--ds-text-muted);
}

.zone-file-picker__selected {
  border: 1px solid var(--ds-border-default);
  border-radius: 8px;
  overflow: hidden;
}

.zone-file-picker__selected-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--ds-bg-tertiary);
  border-bottom: 1px solid var(--ds-border-default);
  font-size: 12px;
  font-weight: 600;
  color: var(--ds-text-secondary);
}

.zone-file-picker__clear {
  font-size: 11px;
  font-weight: 400;
  color: var(--ds-text-muted);
  background: none;
  border: none;
  cursor: pointer;
}

.zone-file-picker__clear:hover {
  color: var(--ds-semantic-danger);
}

.zone-file-picker__selected-list {
  max-height: 160px;
  overflow-y: auto;
}

.zone-file-picker__selected-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--ds-border-default);
}

.zone-file-picker__selected-item:last-child {
  border-bottom: none;
}

.zone-file-picker__selected-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.zone-file-picker__selected-name {
  flex: 1;
  font-size: 12px;
  color: var(--ds-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.zone-file-picker__selected-source {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--ds-text-muted);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.zone-file-picker__selected-remove {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  font-size: 14px;
  color: var(--ds-text-muted);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.zone-file-picker__selected-remove:hover {
  color: var(--ds-semantic-danger);
  background: rgba(255, 68, 68, 0.1);
}

.zone-file-picker__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
