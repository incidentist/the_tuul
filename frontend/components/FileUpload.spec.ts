import 'jest';
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