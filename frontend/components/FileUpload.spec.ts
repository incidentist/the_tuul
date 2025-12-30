import { mount } from '@vue/test-utils';
import FileUpload from './FileUpload.vue';
import { createMockAudioFile } from '@/test-utils';

describe('FileUpload', () => {
  it('renders a file upload component', () => {
    const wrapper = mount(FileUpload, {
      props: {
        label: 'Upload a file',
        modelValue: null,
      },
      global: {
        stubs: {
          'b-field': false,
          'b-upload': false,
          'b-icon': true,
          'b-button': true,
        },
      },
    });

    expect(wrapper.find('.file-label').exists()).toBe(true);
    expect(wrapper.find('.file-name').text()).toBe('No file chosen');
  });

  it('displays the current file name when modelValue prop is provided', () => {
    const file = new File(['contents'], 'existing-file.mp3');
    const wrapper = mount(FileUpload, {
      props: {
        label: 'Upload a file',
        modelValue: file,
      },
      global: {
        stubs: {
          'b-field': false,
          'b-upload': false,
          'b-icon': true,
          'b-button': true,
        },
      },
    });

    expect(wrapper.find('.file-name').text()).toBe('existing-file.mp3');
  });

  it('emits update:modelValue when file changes', async () => {
    const wrapper = mount(FileUpload, {
      props: {
        label: 'Upload a file',
        modelValue: null,
      },
      global: {
        stubs: {
          'b-field': false,
          'b-upload': false,
          'b-icon': true,
          'b-button': true,
        },
      },
    });

    const file = createMockAudioFile('song.mp3');

    // Set file through computed property
    wrapper.vm.file = file;
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('update:modelValue')).toBeTruthy();
    expect(wrapper.emitted('update:modelValue')[0]).toEqual([file]);
  });

  it('can clear the file', async () => {
    const file = new File(['contents'], 'test.mp3');
    const wrapper = mount(FileUpload, {
      props: {
        label: 'Upload a file',
        modelValue: file,
      },
      global: {
        stubs: {
          'b-field': false,
          'b-upload': false,
          'b-icon': true,
          'b-button': false,
        },
      },
    });

    expect(wrapper.find('.file-name').text()).toBe('test.mp3');

    wrapper.vm.file = null;
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('update:modelValue')).toBeTruthy();
    const emissions = wrapper.emitted('update:modelValue');
    expect(emissions[emissions.length - 1]).toEqual([null]);
  });

  it('shows delete button only when file is present', async () => {
    const wrapper = mount(FileUpload, {
      props: {
        label: 'Upload a file',
        modelValue: null,
      },
      global: {
        stubs: {
          'b-field': false,
          'b-upload': false,
          'b-icon': true,
          'b-button': false,
        },
      },
    });

    // No delete button when no file
    let deleteButton = wrapper.find('button');
    expect(deleteButton.exists()).toBe(false);

    // Delete button appears when file is set
    const file = createMockAudioFile('test.mp3');
    wrapper.vm.file = file;
    await wrapper.vm.$nextTick();

    deleteButton = wrapper.find('button');
    expect(deleteButton.exists()).toBe(true);
  });
});
