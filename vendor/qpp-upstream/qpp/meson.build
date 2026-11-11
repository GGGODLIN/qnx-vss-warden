#
# Copyright (c) 2026, BlackBerry Limited. All rights reserved.
#
# BlackBerry Limited and its licensors  retain all intellectual property and
# proprietary rights in and to this software and related documentation.  Any
# use, reproduction, disclosure or distribution of this software and related
# documentation without an express license agreement from BlackBerry Limited
# is strictly prohibited.
#

qpp_use_src = custom_target(
  'qpp-use.c',
  input : files('qpp.use'),
  output : 'qpp-use.c',
  command : [
    python,
    generate_use,
    '@INPUT@',
    '@OUTPUT@',
  ],
)

qpp_sources = files(
  'catalog.c',
  'directory.c',
  'initialization.c',
  'inode.c',
  'ioclose.c',
  'iomknod.c',
  'iomknod_read_only.c',
  'ionotify.c',
  'ioopen.c',
  'ioread.c',
  'ioread_dir.c',
  'ioread_text.c',
  'ioseek.c',
  'iounlink.c',
  'iounlink_read_only.c',
  'iowrite.c',
  'iowrite_text.c',
  'main.c',
  'metadata.c',
  'node.c',
  'ocb.c',
  'tree.c',
  'utils/base64.c',
  'utils/utils.c',
  'value.c',
)

qpp = executable(
  'qpp',
  qpp_sources,
  qpp_use_src,
  c_args : common_c_args + ['-DSERVICE_NAME="QNX POSIX PubSub Service"'],
  include_directories : include_directories('.', 'utils'),
  dependencies : [libqpp_dep, json_dep, slog2_dep],
  install : true,
)
