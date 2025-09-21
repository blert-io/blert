import {
  Define as AppendixDefine,
  Ref as AppendixRef,
  List as AppendixList,
} from './appendix';
import { Code } from './code';
import { Heading } from './heading';
import { Notice, Page, Tooltip } from './article';
import { TableOfContents } from './table-of-contents';
import { Tabs } from './tabs';

const Appendix = {
  Define: AppendixDefine,
  Ref: AppendixRef,
  List: AppendixList,
};

const Article = {
  Appendix,
  Code,
  Heading,
  Notice,
  Page,
  TableOfContents,
  Tabs,
  Tooltip,
};

export default Article;
