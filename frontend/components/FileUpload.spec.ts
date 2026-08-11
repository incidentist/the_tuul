import { mount } from '@vue/test-utils';
import FileUpload from './FileUpload.vue';

describe('FileUpload', () => {
  it('renders a file upload input', () => {
    const wrapper = mount(FileUpload, {
      propsData: {
        label: 'Upload a file',
        value: null,
      },
    });

    expect(wrapper.find('.file-label').exists()).toBe(true);
    expect(wrapper.find('.file-name').text()).toBe('No file chosen');
  });

  describe('accept', () => {
    // The accept prop was previously undeclared, so callers passing
    // :accept="['.json']" silently got a picker that accepted anything.
    it('joins a list of extensions into an accept string', () => {
      const wrapper = mount(FileUpload, {
        propsData: { label: 'Timings File', accept: ['.json', '.txt'] },
      });

      expect(wrapper.vm.acceptAttribute).toBe('.json,.txt');
    });

    it('passes a string through unchanged', () => {
      const wrapper = mount(FileUpload, {
        propsData: { label: 'Timings File', accept: 'audio/*' },
      });

      expect(wrapper.vm.acceptAttribute).toBe('audio/*');
    });

    it('is null when no accept is given', () => {
      const wrapper = mount(FileUpload, {
        propsData: { label: 'Upload a file' },
      });

      expect(wrapper.vm.acceptAttribute).toBeNull();
    });
  });

  // it('displays the file name when a file is selected', async () => {
  //   const wrapper = mount(FileUpload, {
  //     localVue,
  //     propsData: {
  //       label: 'Upload a file',
  //       value: null,
  //     },
  //   });

  //   // Log the HTML to debug
  //   // console.log(wrapper.find('input[type="file"]').html());

  //   const file = new File(['file contents'], 'file.txt');
  //   await wrapper.find('input[type="file"]').trigger('change', {target});

  //   expect(wrapper.find('.file-name').text()).toBe('file.txt');
  // });

  // it('emits an input event when a file is selected', async () => {
  //   const wrapper = mount(FileUpload, {
  //     propsData: {
  //       label: 'Upload a file',
  //       value: null,
  //     },
  //   });

  //   const file = new File(['file contents'], 'file.txt');
  //   await wrapper.find('input[type="file"]').setValue(file);

  //   expect(wrapper.emitted('update:value')).toHaveLength(1);
  //   expect(wrapper.emitted('update:value')[0]).toEqual([file]);
  // });
});