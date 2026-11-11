project('qpp-warden-host-integration', 'c', meson_version: '>=1.10', default_options: ['c_std=c11'])
cc = meson.get_compiler('c')
qpp = get_option('qpp_source')
incs = include_directories('include', qpp, qpp / 'utils')
sources = ['catalog.c', 'node.c', 'tree.c', 'value.c', 'metadata.c', 'directory.c', 'inode.c', 'ocb.c', 'ioopen.c', 'ioread.c', 'ioread_text.c', 'iowrite.c', 'iowrite_text.c', 'ioclose.c', 'utils/utils.c', 'utils/base64.c', 'qpp_warden.c', 'vss_warden_core.c']
upstream = []
foreach source : sources
  upstream += qpp / source
endforeach
integration = executable('qpp-warden-integration', upstream + ['integration.c', 'transport.c', 'json.c'],
  include_directories: incs,
  c_args: ['-D_GNU_SOURCE', '-DEOK=0', '-DSERVICE_NAME="QPP host integration"'],
  dependencies: [dependency('json-c'), dependency('threads'), cc.find_library('m')])
test('real-upstream-qpp', integration, args: [meson.current_source_dir() / 'catalog.json'])
